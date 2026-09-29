/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Languages, Clock, Download } from 'lucide-react';
import Translator from './components/Translator';
import HistoryPage from './components/HistoryPage';
import { TranslationHistoryItem } from './types';
import { getTranslationHistory } from './utils/historyStorage';

export default function App() {
  const [activePage, setActivePage] = useState<'translator' | 'history'>('translator');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<TranslationHistoryItem | null>(null);
  const [historyCount, setHistoryCount] = useState<number>(0);

  const updateCount = () => {
    const items = getTranslationHistory();
    setHistoryCount(items.length);
  };

  useEffect(() => {
    updateCount();
    const handleUpdate = () => updateCount();
    window.addEventListener('translation-history-changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('translation-history-changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const handleSelectFromHistory = (item: TranslationHistoryItem) => {
    setSelectedHistoryItem(item);
    setActivePage('translator');
  };

  // PWA Install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standaloneMode);

    // Detect iOS
    const isIOSDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    setIsIOS(isIOSDevice);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      setShowIOSPrompt(true);
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 flex flex-col selection:bg-blue-100 selection:text-blue-900 m-0 p-0">
      {/* Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-2xs">
        <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 flex items-center justify-between h-14 sm:h-16">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs text-sm sm:text-base">
              <Languages className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <span className="font-bold text-gray-900 tracking-tight text-sm sm:text-base">
                AI Translator
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-3">
            {/* PWA In-App Install Button */}
            {!isStandalone && (deferredPrompt || isIOS) && (
              <button
                onClick={handleInstallApp}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-xs transition-all active:scale-95 cursor-pointer"
                title="Install Application on Home Screen"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">انسٹال (Install)</span>
              </button>
            )}

            {/* Page Navigation Tabs */}
            <nav className="flex items-center space-x-1 bg-gray-100/90 p-1 rounded-xl border border-gray-200">
              <button
                onClick={() => setActivePage('translator')}
                className={`flex items-center space-x-1 sm:space-x-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activePage === 'translator'
                    ? 'bg-white text-teal-700 shadow-2xs font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <Languages className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Translate</span>
              </button>

              <button
                onClick={() => setActivePage('history')}
                className={`flex items-center space-x-1 sm:space-x-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                  activePage === 'history'
                    ? 'bg-white text-teal-700 shadow-2xs font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>History</span>
                {historyCount > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] sm:text-xs font-bold ${
                    activePage === 'history' 
                      ? 'bg-teal-100 text-teal-800' 
                      : 'bg-gray-200 text-gray-700'
                  }`}>
                    {historyCount}
                  </span>
                )}
              </button>
            </nav>

            {/* Standalone Single HTML File Direct Link/Download */}
            <a
              href="/single-file-translator.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors shadow-2xs"
              title="Open or save complete single-file version"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">ایک فائل (.html)</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area - Full-screen edge-to-edge on mobile, zero outer gutter */}
      <main className="flex-grow flex items-start justify-center w-full p-0 sm:py-5 sm:px-4">
        {activePage === 'translator' ? (
          <Translator
            initialItem={selectedHistoryItem}
            onOpenHistory={() => setActivePage('history')}
          />
        ) : (
          <HistoryPage
            onSelectTranslation={handleSelectFromHistory}
            onNavigateToTranslator={() => setActivePage('translator')}
          />
        )}
      </main>

      {/* iOS Safari PWA Installation Instructions Modal */}
      {showIOSPrompt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full text-center shadow-2xl">
            <div className="text-3xl mb-2">📲</div>
            <h3 className="text-base font-bold text-gray-900 mb-1">Install on iPhone / iPad</h3>
            <p className="text-xs text-gray-600 text-left bg-gray-50 p-3 rounded-xl my-3 leading-relaxed">
              1. Tap the <strong>Share</strong> button (⎙) in your Safari toolbar.<br />
              2. Scroll down and tap <strong>"Add to Home Screen"</strong>.
            </p>
            <button
              onClick={() => setShowIOSPrompt(false)}
              className="w-full py-2 bg-teal-600 text-white text-xs font-bold rounded-xl"
            >
              Done (ٹھیک ہے)
            </button>
          </div>
        </div>
      )}

      <footer className="py-4 text-center text-xs text-gray-400 border-t border-gray-100 hidden sm:block">
        <p>AI Translator • Instant speech & text translation • PWA Enabled</p>
      </footer>
    </div>
  );
}

