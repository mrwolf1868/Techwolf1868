import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal as TerminalIcon, 
  Settings, 
  Users, 
  ShieldCheck, 
  Zap, 
  Cpu, 
  Network, 
  Bot, 
  Info, 
  Activity,
  ChevronRight,
  Code2,
  Lock,
  Wand2,
  RefreshCw,
  LogOut,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';

const COMMANDS_CATEGORIES = [
  { id: 'general', name: 'General', icon: Wand2, commands: ['menu', 'ping', 'alive', 'owner', 'runtime', 'speed', 'id', 'link', 'deploybot', 'afk', 'reminder'] },
  { id: 'ai', name: 'AI System', icon: Bot, commands: ['ai', 'ask', 'chatgpt', 'chatbot', 'autoreply', 'resetai'] },
  { id: 'admin', name: 'Group Admin', icon: Users, commands: ['add', 'kick', 'promote', 'demote', 'tagall', 'hidetag', 'linkgc', 'mute', 'unmute', 'welcome', 'goodbye'] },
  { id: 'protection', name: 'Protection', icon: ShieldCheck, commands: ['antilink', 'antispam', 'antimention', 'antitag', 'warn', 'block', 'unblock'] },
  { id: 'utilities', name: 'Utilities', icon: Zap, commands: ['sticker', 'toimg', 'play', 'translate', 'calc', 'tts', 'shorturl', 'qr', 'readqr', 'viewonce'] },
  { id: 'owner', name: 'Owner Only', icon: Lock, commands: ['admin', 'addadmin', 'removeadmin', 'broadcast', 'setprefix', 'setmenuimage', 'shutdown', 'userjoin'] },
];

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState({ uptime: 0, status: 'Active', latency: 0 });
  const [activeTab, setActiveTab] = useState('terminal');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('log', (msg: string) => {
      setLogs(prev => [...prev.slice(-100), msg]);
    });

    newSocket.on('stats', (newStats) => {
      setStats(newStats);
    });

    newSocket.on('pairing-code', (code: string) => {
      setPairingCode(code);
      setIsPairing(false);
    });

    fetch('/api/logs').then(r => r.json()).then(setLogs);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handlePair = async () => {
    if (!phoneNumber) return;
    setIsPairing(true);
    setPairingCode(null);
    try {
      await fetch(`/?number=${phoneNumber.replace(/[^0-9]/g, '')}`);
    } catch (e) {
      setIsPairing(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* Sidebar navigation */}
      <aside className="w-20 lg:w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col items-center lg:items-stretch group transition-all duration-300">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Wand2 className="text-white w-6 h-6" />
          </div>
          <span className="hidden lg:block font-bold text-xl tracking-tight text-white">TECHWIZARD</span>
        </div>

        <nav className="flex-1 mt-6 px-4 space-y-2">
          <NavButton active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} icon={TerminalIcon} label="Console" />
          <NavButton active={activeTab === 'commands'} onClick={() => setActiveTab('commands')} icon={Code2} label="Commands" />
          <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Settings" />
          <NavButton active={activeTab === 'info'} onClick={() => setActiveTab('info')} icon={Info} label="System Info" />
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="hidden lg:block bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Server Latency</span>
              <span className="text-green-400 font-mono">{stats.latency}ms</span>
            </div>
            <div className="w-full bg-slate-700 h-1 rounded-full overflow-hidden">
              <motion.div 
                className="bg-violet-500 h-full" 
                initial={{ width: '10%' }} 
                animate={{ width: '45%' }} 
                transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-20 border-bottom border-slate-800 px-8 flex items-center justify-between bg-slate-950/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-green-500">SYSTEM {stats.status}</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-slate-500 text-xs">
              <Activity className="w-4 h-4" />
              <span>UPTIME: {formatUptime(stats.uptime)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg transition-colors">
              <RefreshCw className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-slate-800 mx-2" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center">
                <Users className="w-4 h-4 text-slate-300" />
              </div>
              <span className="hidden sm:block text-sm font-medium">Owner_01</span>
            </div>
          </div>
        </header>

        <div className="flex-1 p-8 overflow-y-auto terminal-scrollbar">
          <AnimatePresence mode="wait">
            {activeTab === 'terminal' && (
              <motion.div 
                key="terminal"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full flex flex-col gap-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard icon={Cpu} label="CPU Usage" value="12.4%" color="sky" />
                  <StatCard icon={Network} label="Incoming" value="2.1 MB/s" color="violet" />
                  <StatCard icon={Zap} label="Requests" value="1.2k" color="amber" />
                </div>

                <div className="flex-1 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col overflow-hidden shadow-2xl">
                  <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                    <div className="flex items-center gap-2">
                      <TerminalIcon className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-mono font-bold tracking-tight text-white">SYSTEM_LOGS</span>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/40" />
                      <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40" />
                    </div>
                  </div>
                  <div className="flex-1 p-6 font-mono text-sm overflow-y-auto terminal-scrollbar bg-black/40">
                    {logs.length === 0 ? (
                      <div className="text-slate-600 italic">Waiting for logs...</div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} dangerouslySetInnerHTML={{ __html: log }} />
                      ))
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'commands' && (
              <motion.div 
                key="commands"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              >
                {COMMANDS_CATEGORIES.map((cat) => (
                  <div key={cat.id} className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 hover:border-violet-500/30 transition-all group">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-slate-800 rounded-xl group-hover:bg-violet-600/20 transition-colors">
                        <cat.icon className="w-6 h-6 text-violet-400" />
                      </div>
                      <h3 className="text-lg font-bold text-white">{cat.name}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {cat.commands.map(cmd => (
                        <span key={cmd} className="px-3 py-1 bg-slate-800 rounded-lg text-xs font-mono text-slate-400 border border-slate-700/50 hover:text-violet-400 hover:border-violet-500/50 cursor-pointer transition-all">
                          {cmd}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl mx-auto w-full"
              >
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-white mb-1">Pairing System</h2>
                      <p className="text-sm text-slate-400">Connect your WhatsApp instance here</p>
                    </div>
                    <div className="w-12 h-12 bg-violet-600/10 rounded-full flex items-center justify-center border border-violet-600/20">
                      <Lock className="w-6 h-6 text-violet-400" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-medium text-slate-300">Phone Number (with country code)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="e.g. 254111967697" 
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
                      />
                      <button 
                        onClick={handlePair}
                        disabled={isPairing || !phoneNumber}
                        className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all shadow-lg shadow-violet-600/20 flex items-center gap-2"
                      >
                        {isPairing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {isPairing ? 'GENERATING...' : 'PAIR DEVICE'}
                      </button>
                    </div>
                  </div>

                  {pairingCode && (
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-violet-600/10 border border-violet-500/30 rounded-2xl p-8 text-center"
                    >
                      <p className="text-xs uppercase tracking-widest text-violet-400 font-bold mb-4">Your Pairing Code</p>
                      <div className="text-5xl font-mono font-bold tracking-[0.2em] text-white">
                        {pairingCode}
                      </div>
                      <p className="text-xs text-slate-500 mt-6">Open WhatsApp &gt; Connected Devices &gt; Link Device &gt; Use Pairing Code</p>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Right panel - Quick Actions (Hidden on mobile) */}
      <aside className="hidden xl:flex w-80 border-l border-slate-800 bg-slate-900/30 flex-col">
        <div className="p-8 space-y-8">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6 flex items-center justify-between">
              Active Modules
              <span className="bg-green-500/20 text-green-500 px-2 py-0.5 rounded text-[10px]">6 Enabled</span>
            </h3>
            <div className="space-y-3">
              <ModuleToggle label="Always Online" active />
              <ModuleToggle label="Auto Read" active />
              <ModuleToggle label="Anti Link" />
              <ModuleToggle label="AI Chatbot" active />
              <ModuleToggle label="Status Viewer" />
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Quick Tools</h3>
            <div className="grid grid-cols-2 gap-3">
              <ToolButton icon={RefreshCw} label="Reboot" />
              <ToolButton icon={LogOut} label="Logout" danger />
              <ToolButton icon={Users} label="Admins" />
              <ToolButton icon={ShieldCheck} label="Security" />
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function NavButton({ active, icon: Icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
        active 
          ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20' 
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      <Icon className={`w-5 h-5 ${active ? 'text-white' : 'group-hover:text-violet-400'}`} />
      <span className="hidden lg:block font-medium text-sm">{label}</span>
      {active && <motion.div layoutId="nav-pill" className="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
    </button>
  );
}

function StatCard({ icon: Icon, label, value, color }: any) {
  const colors: any = {
    sky: 'bg-sky-500/10 text-sky-500',
    violet: 'bg-violet-500/10 text-violet-500',
    amber: 'bg-amber-500/10 text-amber-500',
  };

  return (
    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 flex items-center gap-6">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

function ModuleToggle({ label, active = false }: any) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-800/30 rounded-xl border border-slate-800/50">
      <span className="text-sm text-slate-300">{label}</span>
      <div className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${active ? 'bg-violet-600' : 'bg-slate-700'}`}>
        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${active ? 'right-1' : 'left-1'}`} />
      </div>
    </div>
  );
}

function ToolButton({ icon: Icon, label, danger }: any) {
  return (
    <button className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-all ${
      danger 
        ? 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500' 
        : 'border-slate-800 bg-slate-800/30 hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
    }`}>
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
