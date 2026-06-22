import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard,
  Settings, 
  Plus, 
  ChevronRight, 
  Zap,
  Activity,
  Layers,
  Monitor,
  Edit3,
  X,
  ArrowUp,
  ArrowDown,
  Archive,
  ArchiveRestore,
  Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

// Types
type ProductionMode = 'L10' | 'L11';

interface WorkOrder {
  id: string;
  woNumber: string;
  mode?: ProductionMode;
  partNumber: string;
  description: string;
  rev?: string;
  pbr?: string;
  status: 'In Progress' | 'Hold' | 'Completed' | 'Pending';
  priority: number;
  // L11 Specific
  serialNumbers?: string[];
  demandQty?: number;
  // L10 Specific
  requestedQty?: number;
  preAssembledQty?: number;
  producedQty?: number;
  currentStation?: string;
  snStatuses?: Record<string, string>;
  isExpanded?: boolean;
  isArchived?: boolean;
  notes?: string;
}

const App: React.FC = () => {
  const [mode, setMode] = useState<ProductionMode>('L11');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isSidebarCollapsed] = useState(false);
  const [isFormOpen, setFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [currentView, setCurrentView] = useState<'Production' | 'Inventory'>('Production');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const API_URL = 'http://localhost:3068/api';

  const [formData, setFormData] = useState<Partial<WorkOrder>>({
    woNumber: '',
    serialNumbers: [''],
    demandQty: 0,
    requestedQty: 0,
    preAssembledQty: 0,
    producedQty: 0,
    notes: ''
  });

  const fetchWorkOrders = async () => {
    try {
      // 1. Try to fetch from the local backend
      const response = await axios.get(`${API_URL}/production`, { timeout: 3000 });
      setWorkOrders(response.data);
      setIsReadOnly(false);
    } catch (error) {
      // 2. If the backend is unreachable (e.g. running off-site on Vercel), fallback to the static public file
      console.log('Backend unreachable, falling back to static read-only data...');
      setIsReadOnly(true);
      try {
        const fallbackResponse = await axios.get('/data.json');
        setWorkOrders(fallbackResponse.data?.workOrders || []);
      } catch (fallbackError) {
        console.error('Failed to fetch fallback data', fallbackError);
      }
    }
  };

  const handleFetchDetails = async () => {
    const snToSearch = mode === 'L11' ? formData.serialNumbers?.[0] : formData.woNumber;
    if (!snToSearch) return;

    try {
      const response = await axios.get(`${API_URL}/sfc/details?sn=${snToSearch}`);
      setFormData(prev => ({
        ...prev,
        woNumber: response.data.woNumber || prev.woNumber,
        partNumber: response.data.partNumber,
        description: response.data.description,
        rev: response.data.rev,
        pbr: response.data.pbr,
        currentStation: response.data.currentStation
      }));
    } catch (error) {
      console.error('SFC Fetch failed', error);
    }
  };

  const handleSaveWO = async () => {
    try {
      if (isEditing && formData.id) {
        const response = await axios.put(`${API_URL}/production/${formData.id}`, formData);
        setWorkOrders(prev => prev.map(wo => wo.id === formData.id ? response.data : wo));
      } else {
        const response = await axios.post(`${API_URL}/production`, {
          ...formData,
          mode,
          status: 'Pending'
        });
        setWorkOrders(prev => [...prev, response.data]);
      }
      setFormOpen(false);
      setIsEditing(false);
      setFormData({ woNumber: '', serialNumbers: [''], demandQty: 0, notes: '' });
    } catch (error) {
      console.error('Failed to save WO', error);
    }
  };

  const openEditModal = (wo: WorkOrder) => {
    setFormData(wo);
    setIsEditing(true);
    setFormOpen(true);
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    try {
      await axios.post(`${API_URL}/production/sync`);
      await fetchWorkOrders();
    } catch (error) {
      console.error('Sync failed', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleArchive = async (id: string) => {
    const wo = workOrders.find(w => w.id === id);
    if (!wo) return;
    const updated = { ...wo, isArchived: !wo.isArchived };
    try {
      const response = await axios.put(`${API_URL}/production/${id}`, updated);
      setWorkOrders(prev => prev.map(w => w.id === id ? response.data : w));
    } catch (error) {
      console.error('Failed to archive WO', error);
    }
  };

  const handleMove = async (id: string, direction: 'up' | 'down') => {
    const newWorkOrders = [...workOrders];
    const index = newWorkOrders.findIndex(wo => wo.id === id);
    
    let swapIndex = -1;
    if (direction === 'up') {
      for (let i = index - 1; i >= 0; i--) {
        if (newWorkOrders[i].mode === mode) {
          swapIndex = i;
          break;
        }
      }
    } else {
      for (let i = index + 1; i < newWorkOrders.length; i++) {
        if (newWorkOrders[i].mode === mode) {
          swapIndex = i;
          break;
        }
      }
    }

    if (swapIndex !== -1) {
      [newWorkOrders[index], newWorkOrders[swapIndex]] = [newWorkOrders[swapIndex], newWorkOrders[index]];
      setWorkOrders(newWorkOrders);
      try {
        await axios.put(`${API_URL}/production/reorder`, {
          orderedIds: newWorkOrders.map(wo => wo.id)
        });
      } catch (error) {
        console.error('Failed to reorder', error);
      }
    }
  };

  const handleToggleExpand = async (id: string) => {
    const wo = workOrders.find(w => w.id === id);
    if (!wo) return;

    // Toggle expansion
    setWorkOrders(prev => prev.map(w => 
      w.id === id ? { ...w, isExpanded: !w.isExpanded } : w
    ));

    // If expanding and has SNs, fetch statuses (only if not in read-only mode)
    if (!wo.isExpanded && wo.serialNumbers && wo.serialNumbers.length > 0) {
      if (isReadOnly) {
        // In read-only mode, we just rely on the synced data.json
        return;
      }
      
      const newStatuses = { ...(wo.snStatuses || {}) };
      let updatedDetails: Partial<WorkOrder> = {};
      
      for (const sn of wo.serialNumbers) {
        if (!sn) continue;
        try {
          const res = await axios.get(`${API_URL}/sfc/details?sn=${sn}`);
          newStatuses[sn] = res.data.currentStation;
          
          // Grab the first successful fetch to populate WO details
          if (!updatedDetails.partNumber && res.data.partNumber && res.data.partNumber !== 'Unknown') {
            updatedDetails = {
              partNumber: res.data.partNumber,
              description: res.data.description,
              rev: res.data.rev,
              pbr: res.data.pbr
            };
          }
        } catch (e) {
          newStatuses[sn] = 'Fetch failed';
        }
      }

      // Update statuses and newly fetched details
      setWorkOrders(prev => prev.map(w => 
        w.id === id ? { ...w, snStatuses: newStatuses, ...updatedDetails } : w
      ));
    }
  };

  useEffect(() => {
    fetchWorkOrders();
  }, []);

  return (
    <div className="flex w-full min-h-screen">
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`glass border-r border-white/10 transition-all duration-300 fixed inset-y-0 left-0 z-50 md:relative h-full ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${isSidebarCollapsed ? 'md:w-20' : 'w-64'}`}>
        <div className="p-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30 shrink-0">
              <Activity className="text-white" size={24} />
            </div>
            {!isSidebarCollapsed && (
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-bold text-xl tracking-tight"
              >
                IGS Dashboard
              </motion.span>
            )}
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden p-2 text-text-dim hover:text-white rounded-lg hover:bg-white/5">
            <X size={20} />
          </button>
        </div>

        <nav className="mt-8 px-4 space-y-2">
          <SidebarItem icon={<LayoutDashboard size={20} />} label="Production" active={currentView === 'Production'} collapsed={isSidebarCollapsed} onClick={() => { setCurrentView('Production'); setIsMobileMenuOpen(false); }} />
          <SidebarItem icon={<Layers size={20} />} label="Inventory" active={currentView === 'Inventory'} collapsed={isSidebarCollapsed} onClick={() => { setCurrentView('Inventory'); setIsMobileMenuOpen(false); }} />
          <SidebarItem icon={<Monitor size={20} />} label="Monitoring" collapsed={isSidebarCollapsed} />
          <SidebarItem icon={<Settings size={20} />} label="Settings" collapsed={isSidebarCollapsed} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-x-hidden">
        {/* Top Header */}
        <header className="h-auto md:h-20 border-b border-white/5 bg-bg-deep/50 backdrop-blur-md z-10 flex items-center py-4 md:py-0">
          <div className="dashboard-content flex flex-col md:flex-row justify-between items-start md:items-center w-full gap-4 md:gap-0">
            <div className="flex flex-wrap items-center gap-4 md:gap-6 w-full md:w-auto">
              {/* Hamburger Menu */}
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden p-2 -ml-2 text-text-dim hover:text-white rounded-lg hover:bg-white/5"
              >
                <Menu size={24} />
              </button>

              {/* Sleek Mode Switcher */}
              <div className="flex gap-2 p-1 bg-black/20 rounded-xl border border-white/5 shrink-0">
                <button 
                  onClick={() => setMode('L10')}
                  className={`btn ${mode === 'L10' ? 'btn-primary shadow-lg shadow-primary/20' : 'btn-ghost text-text-dim hover:text-text-main'} px-4 md:px-6 py-2`}
                >
                  L10
                </button>
                <button 
                  onClick={() => setMode('L11')}
                  className={`btn ${mode === 'L11' ? 'btn-primary shadow-lg shadow-primary/20' : 'btn-ghost text-text-dim hover:text-text-main'} px-4 md:px-6 py-2`}
                >
                  L11
                </button>
              </div>
              
              <div className="flex items-center bg-black/5 dark:bg-black/20 border border-white/10 rounded-xl px-4 py-1.5 focus-within:border-primary/50 transition-all flex-1 min-w-[200px]">
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search orders, SNs..." 
                  className="bg-transparent border-none outline-none text-sm font-medium w-full md:w-64 focus:w-full md:focus:w-80 transition-all placeholder:text-text-dim/50 h-8"
                />
              </div>

              <div className="hidden md:block h-8 w-[1px] bg-white/10 mx-2" />

              {isReadOnly ? (
                <div className="px-4 py-2 bg-warning/10 border border-warning/20 rounded-xl flex items-center gap-2">
                  <Monitor size={16} className="text-warning" />
                  <span className="text-xs font-bold text-warning uppercase tracking-wider hidden md:inline">Read-Only Mode</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 ml-auto md:ml-0">
                  <button 
                    onClick={handleSyncAll}
                    disabled={isSyncing}
                    className="btn btn-ghost text-text-dim hover:text-primary transition-all group p-2 md:p-3"
                    title="Sync Status"
                  >
                    <Activity size={18} className={isSyncing ? 'animate-spin' : 'group-hover:rotate-12'} />
                    <span className="hidden md:inline text-xs font-bold uppercase tracking-wider ml-2">Sync Status</span>
                  </button>

                  {currentView === 'Production' && (
                    <button 
                      className="btn btn-primary px-4 md:px-6 py-2 shadow-lg shadow-primary/20 flex items-center gap-2"
                      onClick={() => { setIsEditing(false); setFormData({ woNumber: '', serialNumbers: [''], demandQty: 0, notes: '' }); setFormOpen(true); }}
                    >
                      <Plus size={18} />
                      <span className="hidden md:inline">Add Entry</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 hidden md:flex">
              <div className="text-right">
                <p className="text-xs text-text-dim font-bold uppercase">SFC Status</p>
                <p className="text-sm font-semibold text-success flex items-center gap-1.5 justify-end">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Connected
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Form Panel Overlay */}
        <AnimatePresence>
          {isFormOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setFormOpen(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, x: '-50%', y: '-40%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.9, x: '-50%', y: '-40%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                style={{ left: '50%', top: '50%' }}
                className="fixed w-[600px] h-fit max-h-[90vh] glass border border-white/10 rounded-2xl z-50 p-8 overflow-y-auto shadow-2xl"
              >
                <div className="flex justify-between items-center mb-8">
                  <h2>{isEditing ? 'Edit' : 'Add New'} {mode} WO</h2>
                  <button onClick={() => setFormOpen(false)} className="btn btn-ghost p-1 rounded-full hover:bg-white/10">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-text-dim uppercase mb-2">Work Order Number</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={formData.woNumber}
                        onChange={e => setFormData({...formData, woNumber: e.target.value})}
                        className="flex-1" 
                        placeholder="e.g. 3300045" 
                      />
                      <button onClick={handleFetchDetails} className="btn btn-ghost px-3 border border-white/10">
                        <Zap size={16} className="text-primary" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-text-dim uppercase mb-2">Part Number</label>
                      <input 
                        type="text" 
                        value={formData.partNumber}
                        readOnly
                        className="w-full bg-white/5 opacity-70" 
                        placeholder="Auto-filled" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-text-dim uppercase mb-2">Status</label>
                      <select className="w-full">
                        <option>Pending</option>
                        <option>In Progress</option>
                        <option>Hold</option>
                      </select>
                    </div>
                  </div>

                  {mode === 'L11' ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-text-dim uppercase mb-2">Serial Numbers</label>
                        <div className="space-y-2">
                          {formData.serialNumbers?.map((sn, idx) => (
                            <input 
                              key={idx}
                              type="text" 
                              value={sn}
                              onChange={e => {
                                const newSNs = [...(formData.serialNumbers || [])];
                                newSNs[idx] = e.target.value;
                                setFormData({...formData, serialNumbers: newSNs});
                              }}
                              className="w-full" 
                              placeholder={`SN ${idx + 1}`} 
                            />
                          ))}
                          <button 
                            onClick={() => setFormData({...formData, serialNumbers: [...(formData.serialNumbers || []), '']})}
                            className="text-xs text-primary font-bold hover:underline"
                          >
                            + Add Another SN
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-text-dim uppercase mb-2">Demand Quantity</label>
                        <input 
                          type="number" 
                          value={formData.demandQty}
                          onChange={e => setFormData({...formData, demandQty: parseInt(e.target.value)})}
                          className="w-full" 
                        />
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-text-dim uppercase mb-2">Req</label>
                        <input type="number" className="w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-text-dim uppercase mb-2">Pre-Assy</label>
                        <input type="number" className="w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-text-dim uppercase mb-2">Produced</label>
                        <input type="number" className="w-full" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-text-dim uppercase mb-2">Notes / Remarks</label>
                    <textarea 
                      value={formData.notes || ''}
                      onChange={e => setFormData({...formData, notes: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm min-h-[100px] focus:border-primary/50 transition-colors"
                      placeholder="Add any internal remarks or special instructions..."
                    />
                  </div>

                  <div className="pt-8">
                    <button onClick={handleSaveWO} className="btn btn-primary w-full py-4 text-lg">
                      {isEditing ? 'Save Changes' : 'Create Production Entry'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto pt-8">
          <div className="dashboard-content">
            <header className="mb-12 flex justify-between items-end">
              <div>
                <p className="text-primary font-semibold text-[10px] uppercase tracking-[0.4em] mb-3">Real-time Manufacturing</p>
                <h1 className="text-4xl md:text-5xl font-black tracking-tighter">{currentView === 'Inventory' ? 'Inventory' : `${mode} Production`}</h1>
              </div>
              
              <div className="flex items-center gap-4 glass px-6 py-3 rounded-2xl border border-white/5">
                <div className="flex flex-col items-end">
                  <p className="text-[10px] font-black text-text-dim uppercase tracking-widest">{currentView === 'Inventory' ? 'Archived Orders' : 'Active Orders'}</p>
                  <p className="text-2xl font-black text-primary">{workOrders.filter(w => w.mode === mode && (currentView === 'Inventory' ? w.isArchived : !w.isArchived)).length}</p>
                </div>
              </div>
            </header>

            <div className="space-y-4">
            <AnimatePresence mode="popLayout">
              {workOrders
                .filter(wo => wo.mode === mode)
                .filter(wo => currentView === 'Inventory' ? wo.isArchived : !wo.isArchived)
                .filter(wo => 
                  wo.woNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  wo.partNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  wo.serialNumbers?.some(sn => sn.toLowerCase().includes(searchQuery.toLowerCase()))
                )
                .map((wo, index) => (
                <motion.div 
                  key={wo.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  onClick={() => handleToggleExpand(wo.id)}
                  className="card group flex items-start gap-8 cursor-pointer relative hover:border-primary/20"
                >
                  <div className="flex flex-col items-center gap-0.5 pt-1 min-w-[32px] select-none">
                    {!isReadOnly && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMove(wo.id, 'up'); }}
                        className="text-text-dim hover:text-primary transition-all active:scale-125 p-0 bg-transparent border-none outline-none shadow-none focus:outline-none"
                        style={{ background: 'transparent', border: 'none', padding: 0 }}
                      >
                        <ArrowUp size={24} strokeWidth={3} />
                      </button>
                    )}
                    <span className="text-[11px] font-black text-primary/40 tracking-tighter">{index + 1}</span>
                    {!isReadOnly && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleMove(wo.id, 'down'); }}
                        className="text-text-dim hover:text-primary transition-all active:scale-125 p-0 bg-transparent border-none outline-none shadow-none focus:outline-none"
                        style={{ background: 'transparent', border: 'none', padding: 0 }}
                      >
                        <ArrowDown size={24} strokeWidth={3} />
                      </button>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col w-full min-w-0 pr-12 md:pr-0">
                    <div className="flex flex-col md:grid md:grid-cols-8 gap-3 md:gap-6 items-start md:items-center w-full">
                      <div>
                        <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">Work Order</p>
                        <p className="font-bold text-lg">{wo.woNumber}</p>
                      </div>

                      <div className="col-span-2">
                        <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">PN</p>
                        <p className="font-bold truncate">{wo.partNumber}</p>
                      </div>

                      <div>
                        <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">BOM REV</p>
                        <p className="font-semibold text-text-muted">{wo.rev || '-'}</p>
                      </div>

                      <div>
                        <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">PBR</p>
                        <p className="font-semibold text-text-muted">{wo.pbr || '-'}</p>
                      </div>

                      {mode === 'L11' ? (
                        <>
                          <div>
                            <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">SN Count</p>
                            <p className="font-semibold">{wo.serialNumbers?.length || 0} SNs</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">Demand</p>
                            <p className="font-semibold text-secondary">{wo.demandQty}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">Requested</p>
                            <p className="font-semibold">{wo.requestedQty}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-dim uppercase font-bold tracking-widest mb-1">Pre-Assy</p>
                            <p className="font-semibold text-warning">{wo.preAssembledQty}</p>
                          </div>
                        </>
                      )}

                      <div className="flex justify-end">
                        <span className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${
                          wo.status === 'In Progress' ? 'bg-primary/10 text-primary border border-primary/20' :
                          wo.status === 'Hold' ? 'bg-accent/10 text-accent border border-accent/20' :
                          'bg-success/10 text-success border border-success/20'
                        }`}>
                          {wo.status}
                        </span>
                      </div>
                    </div>

                    {/* Expanded SN Status List */}
                    <AnimatePresence>
                      {wo.isExpanded && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden mt-8 pt-8 border-t border-white/5"
                        >
                          <div className="space-y-4">
                            <p className="text-[10px] font-black text-text-dim uppercase tracking-[0.3em]">Serial Numbers</p>
                            <div className="space-y-2">
                              {wo.serialNumbers?.map(sn => (
                                <div key={sn} className="flex flex-col md:flex-row md:items-center justify-between py-3 border-b border-white/[0.03] last:border-0 group/sn gap-2 md:gap-4">
                                  <div className="flex items-center gap-4">
                                    <div className={`w-1 h-1 rounded-full shrink-0 ${wo.snStatuses?.[sn] ? 'bg-success' : 'bg-white/10'}`} />
                                    <span className="font-mono text-sm text-text-muted group-hover/sn:text-text-main transition-colors">{sn}</span>
                                  </div>
                                  {wo.snStatuses?.[sn] && (
                                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider bg-primary/5 px-3 py-1.5 rounded-lg border border-primary/10 w-fit">
                                      {wo.snStatuses[sn]}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex flex-col gap-2 ml-auto md:ml-4 absolute top-4 right-4 md:relative md:top-0 md:right-0">
                    {!isReadOnly && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleArchive(wo.id);
                        }}
                        className="btn btn-ghost p-2 rounded-full hover:bg-warning/10 hover:text-warning bg-black/20 md:bg-transparent"
                        title={wo.isArchived ? "Unarchive" : "Archive"}
                      >
                        {wo.isArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                      </button>
                    )}
                    {!isReadOnly && currentView === 'Production' && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(wo);
                        }}
                        className="btn btn-ghost p-2 rounded-full hover:bg-primary/10 hover:text-primary bg-black/20 md:bg-transparent"
                      >
                        <Edit3 size={18} />
                      </button>
                    )}
                    <button className="btn btn-ghost p-2 rounded-full bg-black/20 md:bg-transparent">
                      <ChevronRight size={20} className={`transition-transform duration-300 ${wo.isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </main>
    </div>
  );
};

const SidebarItem: React.FC<{ icon: React.ReactNode, label: string, active?: boolean, collapsed?: boolean, onClick?: () => void }> = ({ 
  icon, label, active, collapsed, onClick 
}) => (
  <div 
    onClick={onClick}
    className={`
      flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all
      ${active ? 'bg-primary/10 text-primary border border-primary/20 shadow-inner shadow-primary/5' : 'text-text-muted hover:bg-white/5 hover:text-text-main'}
    `}
  >
    <div className={active ? 'text-primary' : 'text-text-dim'}>
      {icon}
    </div>
    {!collapsed && <span className="font-medium">{label}</span>}
    {active && !collapsed && (
      <motion.div layoutId="activeDot" className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
    )}
  </div>
);

export default App;
