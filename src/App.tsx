import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Moon,
  RotateCcw,
  Sun,
  Upload,
} from 'lucide-react';
import {
  CONFIG_PRESETS,
  DEFAULT_NODE_CONFIG,
  PLATFORM_OPTIONS,
} from './data/presets';
import {
  NodeConfiguration,
  WizardStep,
  WorkspaceView,
} from './types/nodeConfig';
import { validateNodeConfig } from './utils/validation';
import { generateInstallScript } from './utils/generators';
import { downloadTextFile } from './utils/download';
import { WizardForms } from './components/WizardForms';
import { NodeSummaryInspector } from './components/NodeSummaryInspector';
import { TopologyView } from './components/TopologyView';
import { ConfigFilesView } from './components/ConfigFilesView';
import { InstallerView } from './components/InstallerView';
import { InstallGuideView } from './components/InstallGuideView';

const STORAGE_KEY = 'asl_dvswitch_wizard_config_v2';

const WIZARD_STEPS: { id: WizardStep; title: string; subtitle: string }[] = [
  { id: 1, title: '01. Target Platform', subtitle: 'Raspberry Pi or Debian 13' },
  { id: 2, title: '02. AllStarLink Node', subtitle: 'Node #, Audio & IAX2' },
  { id: 3, title: '03. DVSwitch Bridge', subtitle: 'DMR, YSF, P25 & USRP' },
  { id: 4, title: '04. Security & UI', subtitle: 'UFW, Fail2Ban & Web UI' },
  { id: 5, title: '05. Review & Export', subtitle: 'Installer & Bundle' },
];

const NAV_ITEMS: { id: WorkspaceView; label: string }[] = [
  { id: 'wizard', label: 'Wizard' },
  { id: 'topology', label: 'Topology' },
  { id: 'configs', label: 'Config Files' },
  { id: 'installer', label: 'Installer Script' },
  { id: 'guide', label: 'Deploy Guide' },
];

export default function App() {
  const [config, setConfig] = useState<NodeConfiguration>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<NodeConfiguration>;
        return {
          platform: { ...DEFAULT_NODE_CONFIG.platform, ...(parsed.platform || {}) },
          allstar: { ...DEFAULT_NODE_CONFIG.allstar, ...(parsed.allstar || {}) },
          dvswitch: { ...DEFAULT_NODE_CONFIG.dvswitch, ...(parsed.dvswitch || {}) },
          security: { ...DEFAULT_NODE_CONFIG.security, ...(parsed.security || {}) },
        };
      }
    } catch {
      // Ignore malformed storage
    }
    return DEFAULT_NODE_CONFIG;
  });

  const [step, setStep] = useState<WizardStep>(1);
  const [view, setView] = useState<WorkspaceView>('wizard');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore quota errors
    }
  }, [config]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const issues = useMemo(() => validateNodeConfig(config), [config]);
  const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === config.platform.target);

  const handleDownloadInstaller = () => {
    const script = generateInstallScript(config);
    downloadTextFile(
      `install-asl-${config.allstar.nodeNumber || 'node'}.sh`,
      script,
      'text/x-shellscript'
    );
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = CONFIG_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setConfig((prev) => preset.apply(prev));
    setProfileNotice(`Applied preset: ${preset.name}`);
    setTimeout(() => setProfileNotice(null), 2500);
  };

  const handleExportProfile = () => {
    downloadTextFile(
      `asl-profile-${config.allstar.nodeNumber || 'node'}.json`,
      JSON.stringify(config, null, 2),
      'application/json'
    );
  };

  const handleImportProfile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as NodeConfiguration;
        if (parsed.platform && parsed.allstar && parsed.dvswitch && parsed.security) {
          setConfig(parsed);
          setProfileNotice(`Imported profile from ${file.name}`);
        } else {
          setProfileNotice('Invalid profile JSON structure.');
        }
      } catch {
        setProfileNotice('Failed to parse JSON profile.');
      }
      setTimeout(() => setProfileNotice(null), 2500);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleReset = () => {
    setConfig(DEFAULT_NODE_CONFIG);
    setStep(1);
    setProfileNotice('Reset configuration to defaults.');
    setTimeout(() => setProfileNotice(null), 2500);
  };

  const stepHasError = (s: WizardStep) =>
    issues.some((i) => i.step === s && i.severity === 'error');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1380px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#wizard"
            onClick={(e) => {
              e.preventDefault();
              setView('wizard');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
          >
            AllStarLink Guided Install WebGUI
          </a>

          <nav
            aria-label="Primary workspace navigation"
            className="hidden md:flex items-center gap-6"
          >
            {NAV_ITEMS.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                    active
                      ? 'text-sky-700 dark:text-sky-400 border-sky-700 dark:border-sky-400'
                      : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleDownloadInstaller}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-800 text-white inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download Installer
            </button>
          </div>
        </div>

        {/* Mobile Secondary Nav Row */}
        <div className="md:hidden px-4 pb-2.5 flex items-center gap-3 overflow-x-auto border-t border-slate-100 dark:border-slate-800 pt-2">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Workspace Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60">
        <div className="max-w-[1380px] mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 flex-wrap">
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              Node {config.allstar.nodeNumber || '—'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{config.allstar.callsign || '—'}</span>
            <span aria-hidden="true">·</span>
            <span>{platformMeta?.label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {config.dvswitch.enabled
                ? `DVSwitch ${config.dvswitch.defaultMode}`
                : 'ASL3 Standalone'}
            </span>
            {profileNotice && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-sky-700 dark:text-sky-400 font-medium">
                  {profileNotice}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="preset-select" className="sr-only">
              Load Hardware Preset
            </label>
            <select
              id="preset-select"
              value=""
              onChange={(e) => {
                if (e.target.value) handleApplyPreset(e.target.value);
              }}
              className="min-h-[36px] px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <option value="" disabled>
                Load Preset Profile...
              </option>
              {CONFIG_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportProfile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleExportProfile}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center"
            >
              {darkMode ? (
                <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-[1380px] mx-auto px-6 py-7">
        {view === 'wizard' && (
          <div className="grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_320px] gap-6 items-start">
            {/* Left Wizard Stepper Sidebar */}
            <aside aria-label="Wizard stages" className="space-y-1.5">
              {WIZARD_STEPS.map((item) => {
                const active = step === item.id;
                const hasError = stepHasError(item.id);
                const completed = step > item.id && !hasError;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={`w-full text-left px-3.5 py-3 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                      active
                        ? 'bg-white dark:bg-slate-900 border-sky-600 dark:border-sky-500 text-slate-900 dark:text-slate-100'
                        : 'bg-transparent border-transparent hover:bg-white/70 dark:hover:bg-slate-900/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{item.title}</span>
                      {completed && (
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      {hasError && (
                        <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                          Check
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {item.subtitle}
                    </p>
                  </button>
                );
              })}
            </aside>

            {/* Center Configuration Form */}
            <section className="min-w-0">
              <WizardForms
                step={step}
                config={config}
                issues={issues}
                onChange={setConfig}
                onStepChange={setStep}
                onSwitchView={setView}
              />
            </section>

            {/* Right Validation & Port Allocation Inspector */}
            <NodeSummaryInspector
              config={config}
              issues={issues}
              onJumpToStep={setStep}
              onSwitchView={setView}
            />
          </div>
        )}

        {view === 'topology' && (
          <TopologyView
            config={config}
            onEditStep={setStep}
            onSwitchView={setView}
          />
        )}

        {view === 'configs' && <ConfigFilesView config={config} />}

        {view === 'installer' && <InstallerView config={config} />}

        {view === 'guide' && <InstallGuideView config={config} />}
      </main>
    </div>
  );
}
