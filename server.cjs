const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');
const { exec } = require('child_process');

const app = express();
const PORT = 3068; 
const DATA_FILE = path.join(__dirname, 'data.json');
const SFC_API_BASE = 'http://10.16.137.111';

app.use(cors());
app.use(bodyParser.json());

// Root route for status
app.get('/', (req, res) => {
    res.send('<h1>IGS Dashboard API Server</h1><p>Status: Running</p>');
});

// Initialize data file if not exists
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ workOrders: [] }, null, 2));
}

// Helper to proxy to SFC JSON API
const callSfcApi = async (endpoint, data) => {
    try {
        const response = await axios.post(`${SFC_API_BASE}/SFCAPI/SFC/${endpoint}`, data, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        let responseData = response.data;
        if (typeof responseData === 'string') {
            try {
                responseData = JSON.parse(responseData);
            } catch (e) {
                // Not JSON
            }
        }
        return responseData;
    } catch (error) {
        console.error(`SFC API Error (${endpoint}):`, error.message);
        return null;
    }
};

// Unified SFC Details Fetcher
app.get('/api/sfc/details', async (req, res) => {
    const { sn } = req.query;
    if (!sn) return res.status(400).json({ error: 'SN is required' });

    console.log(`Fetching real SFC details for SN: ${sn}`);

    // 1. Get Configuration (Part Number, Description, MO)
    const config = await callSfcApi('GetConfigurations', {
        SN: sn,
        STATION_ID: 'IGS_DASHBOARD',
        PROJECT: 'NV_VR200' // Default project
    });

    // 2. Check Route (Current Station)
    const route = await callSfcApi('CheckRoute', {
        SN: sn,
        STATION_ID: 'PRET_05', // As per sample
        EMP_NO: 'T80969',
        MODEL_NAME: 'NV_VR200'
    });

    if (!config && !route) {
        return res.status(404).json({ error: 'SFC data not found' });
    }
    
    console.log('Parsed route:', route);

    // Parse CheckRoute Result: "NG,GO-SYS_ASSY_6 " -> "The SN will be into SYS_ASSY_6 Station"
    let statusMessage = route?.CURR_STATION || 'Unknown';
    if (route?.RESULT && route.RESULT.trim().toUpperCase() === 'OK') {
        statusMessage = 'This SN is in test';
    } else if (route?.RESULT && route.RESULT.includes('OK')) {
        statusMessage = 'This SN is in test';
    } else if (route?.RESULT && route.RESULT.includes('GO-')) {
        const stationMatch = route.RESULT.match(/GO-([^ ]+)/);
        if (stationMatch && stationMatch[1]) {
            statusMessage = `The SN will be into ${stationMatch[1]} Station`;
        }
    } else if (route?.RESULT && route.RESULT.startsWith('NG,')) {
        const stationMatch = route.RESULT.match(/NG,([A-Za-z0-9_-]+)/);
        if (stationMatch && stationMatch[1]) {
            statusMessage = `The SN will be into ${stationMatch[1]} Station`;
        }
    }

    // Process and simplify the response
    const configData = config?.DATA || config;
    const details = {
        woNumber: configData?.MO_NUMBER || 'Unknown',
        partNumber: configData?.Chassis_Part_Number || configData?.PART_NO || configData?.PN || 'Unknown',
        description: configData?.MODEL_NAME || configData?.DESCRIPTION || 'NVIDIA Product',
        rev: configData?.REV || configData?.CUSTOM_REV,
        pbr: configData?.PBR_NO,
        currentStation: statusMessage,
        lastUpdate: new Date().toISOString()
    };

    res.json(details);
});

app.get('/api/production', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        res.json(data.workOrders);
    } catch (e) {
        res.json([]);
    }
});

// Helper to push to github in the background
const triggerCloudSync = () => {
    console.log('Triggering cloud sync (pushing to GitHub)...');
    exec('cp data.json public/data.json && git add public/data.json data.json && git commit -m "chore(data): auto-update dashboard data" && git push origin main', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error pushing to GitHub (No changes or network error): ${error.message}`);
            return;
        }
        console.log(`Successfully synced to GitHub. Remote users will see updates soon.`);
    });
};

app.post('/api/production', (req, res) => {
    const newWO = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    
    newWO.id = Date.now().toString();
    newWO.priority = data.workOrders.length + 1;
    
    data.workOrders.push(newWO);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json(newWO);
    
    triggerCloudSync();
});

app.put('/api/production/reorder', (req, res) => {
    const { orderedIds } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    
    const newWorkOrders = orderedIds.map((id, index) => {
        const wo = data.workOrders.find(w => w.id === id);
        return { ...wo, priority: index + 1 };
    });
    
    data.workOrders = newWorkOrders;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
    
    triggerCloudSync();
});

app.put('/api/production/:id', (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    
    const index = data.workOrders.findIndex(w => w.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Work order not found' });
    }
    
    // Preserve ID and Priority, update the rest
    data.workOrders[index] = { ...data.workOrders[index], ...updateData, id, priority: data.workOrders[index].priority };
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json(data.workOrders[index]);
    
    triggerCloudSync();
});

// Sync Status for all active WOs
app.post('/api/production/sync', async (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    let updatedCount = 0;

    for (let wo of data.workOrders) {
        // If it's L11, we might have multiple SNs. For now, track the first one or the WO itself.
        const snToTrack = wo.serialNumbers && wo.serialNumbers[0] ? wo.serialNumbers[0] : null;
        if (snToTrack) {
            const route = await callSfcApi('CheckRoute', { SN: snToTrack, STATION_ID: 'IGS_DASHBOARD' });
            if (route) {
                wo.currentStation = route.CURR_STATION || wo.currentStation;
                updatedCount++;
            }
        }
    }

    if (updatedCount > 0) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ updated: updatedCount });
    
    triggerCloudSync();
});

// Static files (for production build)
app.use(express.static(path.join(__dirname, 'dist')));

app.listen(PORT, () => {
    console.log(`IGS Dashboard Server running on http://localhost:${PORT}`);
});
