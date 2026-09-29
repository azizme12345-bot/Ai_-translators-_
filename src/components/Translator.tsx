import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowRightLeft, 
  Mic, 
  MicOff, 
  Volume2, 
  Copy, 
  Trash2, 
  Loader2, 
  Square, 
  History, 
  Clock, 
  ExternalLink,
  Edit2,
  Share2,
  Save,
  Languages,
  Settings,
  Check,
  X
} from 'lucide-react';
import { LANGUAGES, TARGET_LANGUAGES } from '../constants';
import { TranslationHistoryItem } from '../types';
import { saveTranslationToHistory, getTranslationHistory } from '../utils/historyStorage';

// Declare types for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface TranslatorProps {
  initialItem?: TranslationHistoryItem | null;
  onOpenHistory?: () => void;
}

const getLanguageCode = (languageName: string): string => {
  const map: Record<string, string> = {
    "English": "en-US",
    "Urdu": "ur-PK",
    "Punjabi": "pa-PK",
    "Japanese": "ja-JP",
    "Hindi": "hi-IN",
    "Arabic": "ar-SA",
    "French": "fr-FR",
    "German": "de-DE",
    "Spanish": "es-ES",
    "Chinese": "zh-CN",
    "Korean": "ko-KR",
    "Italian": "it-IT",
    "Portuguese": "pt-BR",
    "Russian": "ru-RU",
    "Turkish": "tr-TR",
    "Persian": "fa-IR",
    "Bengali": "bn-BD",
    "Indonesian": "id-ID",
    "Malay": "ms-MY"
  };
  return map[languageName] || "en-US";
};

// Selects the highest quality, most natural sounding voice for Urdu and English
const getOptimalVoice = (langCode: string, synth: SpeechSynthesis): SpeechSynthesisVoice | null => {
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return null;

  const targetLangLower = langCode.toLowerCase();
  const prefix = targetLangLower.split('-')[0];

  if (prefix === 'ur') {
    // 1. Direct Urdu voice (Google اردو, Microsoft Asad, Microsoft Uzma, etc.)
    const directUrdu = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return l.startsWith('ur') || n.includes('urdu');
    });
    if (directUrdu) return directUrdu;

    // 2. High-quality natural Hindi voice (shared phonology in TTS engines produces clear Urdu)
    const naturalHindi = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return (l.startsWith('hi') || n.includes('hindi')) && 
             (n.includes('google') || n.includes('natural') || n.includes('neural') || n.includes('online'));
    }) || voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith('hi'));
    if (naturalHindi) return naturalHindi;
  }

  if (prefix === 'en') {
    // Prioritize natural, fluent English voices (Google US English, Natural, Neural, Jenny, Samantha)
    const naturalEnglish = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return l.startsWith('en') &&
        (n.includes('natural') || n.includes('google') || n.includes('neural') || n.includes('jenny') || n.includes('guy') || n.includes('samantha') || n.includes('aria'));
    });
    if (naturalEnglish) return naturalEnglish;
  }

  // Exact match
  const exact = voices.find(v => v.lang.replace('_', '-').toLowerCase() === targetLangLower);
  if (exact) return exact;

  // Prefix match
  return voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(prefix)) || null;
};

export default function Translator({ initialItem, onOpenHistory }: TranslatorProps = {}) {
  const [sourceLanguage, setSourceLanguage] = useState<string>("Auto Detect");
  const [targetLanguage, setTargetLanguage] = useState<string>("English");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentHistory, setRecentHistory] = useState<TranslationHistoryItem[]>([]);
  const [copiedInput, setCopiedInput] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(() => {
    try {
      return localStorage.getItem('universal_translator_api_key') || '';
    } catch (e) {
      return '';
    }
  });
  
  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'auto' | 'ur' | 'en'>('auto');
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const isListeningRef = useRef<boolean>(false);
  const activeSessionRef = useRef<number>(0);

  // Speech Synthesis & Audio State
  const [speakingTarget, setSpeakingTarget] = useState<'input' | 'output' | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load history from localStorage
  const refreshHistory = () => {
    setRecentHistory(getTranslationHistory());
  };

  useEffect(() => {
    refreshHistory();
    const onHistChange = () => refreshHistory();
    window.addEventListener('translation-history-changed', onHistChange);
    return () => {
      window.removeEventListener('translation-history-changed', onHistChange);
    };
  }, []);

  // When an item is passed from the History page, load it
  useEffect(() => {
    if (initialItem) {
      setInputText(initialItem.sourceText);
      setOutputText(initialItem.translatedText);
      setSourceLanguage(initialItem.sourceLanguage);
      setTargetLanguage(initialItem.targetLanguage);
      setError(null);
    }
  }, [initialItem]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      // Pre-load available voices
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        if (synthRef.current) {
          synthRef.current.getVoices();
        }
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
    }

    return () => {
      cleanupRecognition();
      if (synthRef.current) {
        try {
          synthRef.current.cancel();
        } catch (e) {}
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current = null;
        } catch (e) {}
      }
    };
  }, []);

  // Speech recognition helper to select optimal model language
  const getRecognitionLanguage = () => {
    if (voiceLang === 'ur') return 'ur-PK';
    if (voiceLang === 'en') return 'en-US';
    
    switch (sourceLanguage) {
      case 'Urdu': return 'ur-PK';
      case 'English': return 'en-US';
      case 'Punjabi': return 'pa-PK';
      case 'Arabic': return 'ar-SA';
      case 'Hindi': return 'hi-IN';
      case 'Japanese': return 'ja-JP';
      case 'Chinese': return 'zh-CN';
      case 'Korean': return 'ko-KR';
      case 'French': return 'fr-FR';
      case 'German': return 'de-DE';
      case 'Spanish': return 'es-ES';
      case 'Italian': return 'it-IT';
      case 'Portuguese': return 'pt-BR';
      case 'Russian': return 'ru-RU';
      case 'Turkish': return 'tr-TR';
      case 'Persian': return 'fa-IR';
      case 'Bengali': return 'bn-BD';
      case 'Indonesian': return 'id-ID';
      case 'Malay': return 'ms-MY';
      default: return 'ur-PK';
    }
  };

  const cleanupRecognition = () => {
    isListeningRef.current = false;
    activeSessionRef.current += 1;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch (e) {}
    }
  };

  const handleSwapLanguages = () => {
    if (isListening) {
      stopListening();
    }
    stopSpeaking();
    if (sourceLanguage === "Auto Detect") {
      setSourceLanguage(targetLanguage);
      setTargetLanguage("English"); // Default fallback
    } else {
      setSourceLanguage(targetLanguage);
      setTargetLanguage(sourceLanguage);
    }
    
    // Swap text
    const oldInput = inputText;
    setInputText(outputText);
    setOutputText(oldInput);
    baseTextRef.current = outputText;
  };

  const stopListening = () => {
    isListeningRef.current = false;
    setIsListening(false);
    activeSessionRef.current += 1;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch (e) {}
    }
    baseTextRef.current = inputText;
  };

  const runRecognitionSession = (sessionId: number) => {
    if (!isListeningRef.current || sessionId !== activeSessionRef.current) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    let recognition: any = null;
    try {
      recognition = new SpeechRecognition();
    } catch (e: any) {
      console.warn("Failed to create SpeechRecognition:", e);
      setIsListening(false);
      isListeningRef.current = false;
      return;
    }

    // continuous=false is significantly more stable across Android mobile & Desktop Chrome
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = getRecognitionLanguage();

    recognition.onstart = () => {
      if (sessionId !== activeSessionRef.current || !isListeningRef.current) {
        try { recognition.stop(); } catch (e) {}
        return;
      }
      setIsListening(true);
      isListeningRef.current = true;
      setError(null);
    };

    recognition.onresult = (event: any) => {
      if (sessionId !== activeSessionRef.current || !isListeningRef.current) return;

      let interim = '';
      let final = '';

      for (let i = 0; i < event.results.length; ++i) {
        const res = event.results[i];
        if (res && res[0]) {
          if (res.isFinal) {
            final += res[0].transcript + ' ';
          } else {
            interim += res[0].transcript;
          }
        }
      }

      const spoken = (final + interim).trim();
      const base = baseTextRef.current ? baseTextRef.current.trim() : '';

      if (spoken) {
        const full = base ? `${base} ${spoken}` : spoken;
        setInputText(full);
      }

      if (final.trim()) {
        const finalized = (base ? `${base} ${final.trim()}` : final.trim()).trim();
        baseTextRef.current = finalized;
        setInputText(finalized);
      }
    };

    recognition.onerror = (event: any) => {
      const err = event.error;
      // Normal non-fatal events:
      if (err === 'no-speech' || err === 'aborted') {
        return;
      }

      console.warn("Speech recognition notice:", err);

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError("مائیکروفون کی اجازت نہیں ملی۔ براہ کرم براؤزر سیٹنگز میں مائیک کی اجازت دیں (Microphone permission denied).");
        stopListening();
      } else if (err === 'audio-capture') {
        setError("مائیکروفون دستیاب نہیں ہے۔ براہ کرم چیک کریں کہ مائیک کام کر رہا ہے۔ (No microphone found or already in use).");
        stopListening();
      } else if (err === 'network') {
        setError("نیٹ ورک کا مسئلہ ہے۔ صوتی ان پٹ کے لیے انٹرنیٹ درکار ہے۔ (Network error during speech recognition).");
        stopListening();
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }

      // If user is still listening in this session, seamlessly listen for the next sentence!
      if (isListeningRef.current && sessionId === activeSessionRef.current) {
        setInputText(curr => {
          baseTextRef.current = curr.trim();
          return curr;
        });

        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isListeningRef.current && sessionId === activeSessionRef.current) {
            runRecognitionSession(sessionId);
          }
        }, 120);
      } else {
        setIsListening(false);
        isListeningRef.current = false;
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err: any) {
      console.warn("Speech recognition session start error:", err);
      if (isListeningRef.current && sessionId === activeSessionRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isListeningRef.current && sessionId === activeSessionRef.current) {
            runRecognitionSession(sessionId);
          }
        }, 250);
      }
    }
  };

  const startListening = () => {
    setError(null);
    stopSpeaking();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      isListeningRef.current = false;
      setError("آپ کا براؤزر صوتی ان پٹ (Speech Recognition) کو سپورٹ نہیں کرتا۔ برائے کرم گوگل کروم استعمال کریں۔ (Browser does not support Speech Recognition).");
      return;
    }

    // Reset previous session
    stopListening();

    isListeningRef.current = true;
    setIsListening(true);
    baseTextRef.current = inputText;

    const currentSession = activeSessionRef.current;
    runRecognitionSession(currentSession);
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleVoiceLangChange = (lang: 'auto' | 'ur' | 'en') => {
    setVoiceLang(lang);
    if (isListeningRef.current) {
      baseTextRef.current = inputText;
      stopListening();
      setTimeout(() => {
        startListening();
      }, 150);
    }
  };

  const handleTranslate = async () => {
    if (!inputText.trim()) return;

    if (isListening) {
      stopListening();
    }
    stopSpeaking();

    setIsTranslating(true);
    setError(null);
    setOutputText("");

    // 0. Try client-side Gemini API with customApiKey
    if (customApiKey) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${customApiKey}`;
        const systemPrompt = `You are a high-fidelity translator. Translate the text accurately from '${sourceLanguage}' to '${targetLanguage}'. Deliver only the pristine translated text with zero conversational preambles, introductions, or system explanations. Maintain formatting, code structures, and punctuation identically.`;
        const payloadBody = {
          contents: [
            {
              parts: [
                {
                  text: `${systemPrompt}\n\nText to translate:\n${inputText}`
                }
              ]
            }
          ]
        };
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadBody)
        });
        if (res.ok) {
          const parsed = await res.json();
          const translated = parsed.candidates[0].content.parts[0].text.trim();
          if (translated) {
            setOutputText(translated);
            saveTranslationToHistory(inputText, translated, sourceLanguage, targetLanguage);
            setIsTranslating(false);
            return;
          }
        }
      } catch (geminiErr) {
        console.warn("Client Gemini API key failed, trying fallback...", geminiErr);
      }
    }
    
    // 1. Try server-side API (Gemini API with secure server key)
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText,
          sourceLanguage,
          targetLanguage
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.translation) {
          setOutputText(data.translation);
          saveTranslationToHistory(inputText, data.translation, sourceLanguage, targetLanguage);
          setIsTranslating(false);
          return;
        }
      }
    } catch (apiErr) {
      console.warn("Server /api/translate error or unavailable:", apiErr);
    }

    // 2. High-reliability fallback (for GitHub Pages static deployment or if server is unreachable)
    try {
      const langCodes: Record<string, string> = {
        'Urdu': 'ur',
        'English': 'en',
        'Spanish': 'es',
        'French': 'fr',
        'German': 'de',
        'Arabic': 'ar',
        'Hindi': 'hi',
        'Punjabi': 'pa',
        'Chinese': 'zh',
        'Japanese': 'ja',
        'Russian': 'ru',
        'Turkish': 'tr',
        'Portuguese': 'pt',
        'Italian': 'it',
        'Korean': 'ko'
      };

      const sl = (sourceLanguage && sourceLanguage !== 'Auto Detect' && langCodes[sourceLanguage]) ? langCodes[sourceLanguage] : 'auto';
      const tl = langCodes[targetLanguage] || 'en';

      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(inputText.trim())}`;
      const gRes = await fetch(gUrl);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData && Array.isArray(gData[0])) {
          const translated = gData[0].map((item: any) => item[0]).filter(Boolean).join('');
          if (translated) {
            setOutputText(translated);
            saveTranslationToHistory(inputText, translated, sourceLanguage, targetLanguage);
            setIsTranslating(false);
            return;
          }
        }
      }
      throw new Error("ترجمہ مکمل نہیں ہو سکا۔ برائے مہربانی دوبارہ کوشش کریں۔ (Translation failed. Please try again).");
    } catch (fallbackErr: any) {
      setError(fallbackErr.message || 'ترجمہ سروس تک رسائی حاصل نہیں ہو سکی۔ (Could not reach translation service).');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      const copyBtn = document.getElementById('copy-btn');
      if (copyBtn) {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          if (copyBtn) copyBtn.innerText = originalText;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const stopSpeaking = () => {
    if (synthRef.current) {
      try {
        synthRef.current.cancel();
      } catch (e) {}
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch (e) {}
      audioRef.current = null;
    }
    setSpeakingTarget(null);
    activeUtteranceRef.current = null;
  };

  const speakText = async (text: string, language: string, target: 'input' | 'output') => {
    if (!text || !text.trim()) return;

    // If currently speaking this target, clicking again toggles it off
    if (speakingTarget === target) {
      stopSpeaking();
      return;
    }

    // Stop whatever is currently playing or recording
    stopSpeaking();
    if (isListening) {
      stopListening();
    }

    setSpeakingTarget(target);
    setError(null);

    const langCode = getLanguageCode(language);
    const shortLang = langCode.split('-')[0].toLowerCase();
    const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

    // Helper 1: Play natural human voice audio via server TTS proxy
    const playAudioStream = (): Promise<boolean> => {
      return new Promise((resolve) => {
        try {
          const url = `/api/tts?text=${encodeURIComponent(text.trim())}&lang=${encodeURIComponent(shortLang)}`;
          const audio = new Audio();
          audioRef.current = audio;
          audio.src = url;

          audio.onended = () => {
            setSpeakingTarget(null);
            audioRef.current = null;
            resolve(true);
          };

          audio.onerror = (err) => {
            console.warn("Audio stream playback failed:", err);
            audioRef.current = null;
            resolve(false);
          };

          audio.play().then(() => {
            // Audio started playing successfully
          }).catch((err) => {
            console.warn("Audio play() blocked or error:", err);
            audioRef.current = null;
            resolve(false);
          });
        } catch (e) {
          resolve(false);
        }
      });
    };

    // Helper 2: Fallback to browser SpeechSynthesis
    const playSynth = (): boolean => {
      if (!synth) return false;
      try {
        synth.cancel();
        try { synth.resume(); } catch (e) {}

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        const optimalVoice = getOptimalVoice(langCode, synth);
        if (optimalVoice) {
          utterance.voice = optimalVoice;
        }

        utterance.onstart = () => {
          setSpeakingTarget(target);
        };

        utterance.onend = () => {
          setSpeakingTarget(null);
          activeUtteranceRef.current = null;
        };

        utterance.onerror = (e) => {
          setSpeakingTarget(null);
          activeUtteranceRef.current = null;
        };

        activeUtteranceRef.current = utterance;
        synth.speak(utterance);
        return true;
      } catch (err) {
        return false;
      }
    };

    // Try natural audio stream first (superior pronunciation for Urdu & other languages);
    // if that fails, fallback to browser speech synthesis.
    const streamed = await playAudioStream();
    if (!streamed) {
      const synthesized = playSynth();
      if (!synthesized) {
        setSpeakingTarget(null);
        setError("آواز نہیں چل سکی۔ براہ کرم انٹرنیٹ کنکشن چیک کریں۔ (Unable to play voice audio).");
      }
    }
  };

  const handleClear = () => {
    setInputText("");
    setOutputText("");
    setError(null);
    baseTextRef.current = "";
    if (isListening) {
      stopListening();
    }
    stopSpeaking();
  };

  const handleSelectRecent = (item: TranslationHistoryItem) => {
    setInputText(item.sourceText);
    setOutputText(item.translatedText);
    setSourceLanguage(item.sourceLanguage);
    setTargetLanguage(item.targetLanguage);
    setError(null);
  };

  const handleCopyInput = async () => {
    if (!inputText) return;
    try {
      await navigator.clipboard.writeText(inputText);
      setCopiedInput(true);
      setTimeout(() => setCopiedInput(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyOutput = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleEditOutput = () => {
    if (outputText) {
      setInputText(outputText);
      baseTextRef.current = outputText;
    }
  };

  const handleShareOutput = async () => {
    if (!outputText) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${sourceLanguage} to ${targetLanguage} Translation`,
          text: outputText
        });
      } catch (e) {
        // User cancelled or unsupported
      }
    } else {
      await handleCopyOutput();
    }
  };

  const handleSaveTranslation = () => {
    if (!inputText || !outputText) return;
    saveTranslationToHistory(inputText, outputText, sourceLanguage, targetLanguage);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  return (
    <div className="w-full flex-1 min-h-[calc(100vh-56px)] bg-gradient-to-br from-teal-500 to-cyan-600 p-3 sm:p-5 md:p-6 flex flex-col font-sans rounded-none sm:rounded-3xl sm:shadow-2xl sm:max-w-3xl sm:mx-auto sm:my-3 relative">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between mb-4 sm:mb-6 text-white">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Universal AI Translator</h1>
          <p className="text-xs text-teal-100 mt-0.5">Instant speech & text translation</p>
        </div>
        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border border-white/30 shadow-sm">
          <span className="font-semibold text-sm">U</span>
        </div>
      </header>

      {/* Language Selection Bar */}
      <div className="flex items-center justify-between bg-white/95 backdrop-blur-md p-2 sm:p-2.5 rounded-2xl shadow-lg mb-4">
        <div className="flex items-center gap-1.5 px-3 py-1.5 font-semibold text-gray-800">
          <select
            value={sourceLanguage}
            onChange={(e) => setSourceLanguage(e.target.value)}
            className="bg-transparent font-semibold text-gray-800 outline-none cursor-pointer text-sm sm:text-base pr-1"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
        <button 
          onClick={handleSwapLanguages}
          className="p-2 bg-teal-100 text-teal-700 rounded-full hover:bg-teal-200 transition-transform active:scale-95"
          title="Swap Languages"
        >
          <ArrowRightLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1.5 font-semibold text-gray-800">
          <select
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="bg-transparent font-semibold text-gray-800 outline-none cursor-pointer text-sm sm:text-base pr-1"
          >
            {TARGET_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error alert banner */}
      {error && (
        <div className="mb-4 bg-red-500/90 text-white px-4 py-2.5 rounded-2xl text-xs sm:text-sm shadow-md flex items-center justify-between backdrop-blur-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold ml-2 hover:opacity-80 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col gap-4 sm:gap-6 overflow-y-auto pb-24">
        
        {/* INPUT Section */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-xl flex flex-col relative">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">INPUT</label>
            <div className="flex items-center gap-2">
              {isListening && (
                <span className="flex items-center gap-1 text-xs text-red-500 font-semibold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  سن رہے ہیں... (Listening...)
                </span>
              )}
              {inputText && (
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 hover:text-red-500 p-1 transition-colors"
                  title="Clear text"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {isListening && (
            <div className="flex items-center justify-between bg-red-50 border border-red-200 px-3.5 py-2 rounded-xl mb-3 text-xs font-semibold text-red-600">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                <span>سن رہے ہیں... بولیں (Listening... Speak now)</span>
              </div>
              <button
                onClick={stopListening}
                className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Stop ⏹️
              </button>
            </div>
          )}

          <textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              baseTextRef.current = e.target.value;
            }}
            placeholder="Enter text (up to 1000 words or 5000 characters) or use voice to translate..."
            className="w-full h-32 lg:h-44 text-gray-800 resize-none outline-none text-base sm:text-lg leading-relaxed placeholder:text-gray-400"
          />

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1 sm:gap-2">
              <button 
                onClick={() => speakText(inputText, sourceLanguage, 'input')} 
                disabled={!inputText.trim()}
                className={`p-2 rounded-full transition-colors disabled:opacity-30 ${speakingTarget === 'input' ? 'text-teal-600 bg-teal-50' : 'text-gray-500 hover:text-teal-600 hover:bg-gray-100'}`}
                title="Listen to input"
              >
                <Volume2 className="w-5 h-5"/>
              </button>
              <button 
                onClick={handleCopyInput} 
                disabled={!inputText.trim()}
                className="p-2 text-gray-500 hover:text-teal-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 relative"
                title="Copy input"
              >
                {copiedInput ? <Check className="w-5 h-5 text-teal-600" /> : <Copy className="w-5 h-5"/>}
              </button>
              <button 
                onClick={toggleListening} 
                className={`p-2 rounded-full transition-all ${
                  isListening 
                    ? 'bg-red-500 text-white shadow-md animate-pulse' 
                    : 'text-gray-500 hover:text-teal-600 hover:bg-gray-100'
                }`}
                title={isListening ? "Stop listening" : "Start voice input"}
              >
                {isListening ? <Square className="w-5 h-5"/> : <Mic className="w-5 h-5"/>}
              </button>
              {copiedInput && <span className="text-xs text-teal-600 font-medium ml-1">Copied!</span>}
            </div>

            <button 
              onClick={handleTranslate} 
              disabled={isTranslating || !inputText.trim()}
              className="px-5 sm:px-6 py-2 bg-teal-600 text-white font-semibold rounded-full hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm sm:text-base"
            >
              {isTranslating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Translating...</span>
                </>
              ) : (
                <span>Translate</span>
              )}
            </button>
          </div>
        </div>

        {/* OUTPUT Section */}
        <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-xl flex-1 flex flex-col relative">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">OUTPUT</label>
            {savedToast && (
              <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Saved to history
              </span>
            )}
          </div>
          <div className="flex-1 text-gray-800 text-base sm:text-lg leading-relaxed whitespace-pre-wrap overflow-y-auto min-h-[110px]">
             {isTranslating ? (
               <div className="flex items-center gap-2 text-teal-600 py-4">
                 <Loader2 className="w-5 h-5 animate-spin" />
                 <span>Translating text...</span>
               </div>
             ) : (
               outputText || <span className="text-gray-400 italic">Translation will appear here...</span>
             )}
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1 sm:gap-2">
              <button 
                onClick={() => speakText(outputText, targetLanguage, 'output')} 
                disabled={!outputText}
                className={`p-2 rounded-full transition-colors disabled:opacity-30 ${speakingTarget === 'output' ? 'text-teal-600 bg-teal-50' : 'text-gray-500 hover:text-teal-600 hover:bg-gray-100'}`}
                title="Speak translation"
              >
                <Volume2 className="w-5 h-5"/>
              </button>
              <button 
                onClick={handleCopyOutput} 
                disabled={!outputText}
                className="p-2 text-gray-500 hover:text-teal-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30"
                title="Copy translation"
              >
                {copiedOutput ? <Check className="w-5 h-5 text-teal-600" /> : <Copy className="w-5 h-5"/>}
              </button>
              <button 
                onClick={handleEditOutput} 
                disabled={!outputText}
                className="p-2 text-gray-500 hover:text-teal-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30"
                title="Copy to input to edit or re-translate"
              >
                <Edit2 className="w-5 h-5"/>
              </button>
              <button 
                onClick={handleShareOutput} 
                disabled={!outputText}
                className="p-2 text-gray-500 hover:text-teal-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30"
                title="Share translation"
              >
                <Share2 className="w-5 h-5"/>
              </button>
              <button 
                onClick={handleSaveTranslation} 
                disabled={!outputText}
                className="p-2 text-gray-500 hover:text-teal-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30"
                title="Save translation to history"
              >
                <Save className="w-5 h-5"/>
              </button>
              {copiedOutput && <span className="text-xs text-teal-600 font-medium ml-1">Copied!</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                <Settings className="w-5 h-5 text-teal-600" />
                Settings & Voice
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <label className="block font-medium mb-1 text-gray-800">Voice Recognition Language</label>
                <select
                  value={voiceLang}
                  onChange={(e: any) => setVoiceLang(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 focus:outline-teal-500"
                >
                  <option value="auto">Auto (Match Source Language)</option>
                  <option value="ur">Urdu (اردو - ur-PK)</option>
                  <option value="en">English (US - en-US)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium mb-1 text-gray-800">Gemini / Cloud API Key (Optional)</label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => {
                    setCustomApiKey(e.target.value);
                    try {
                      localStorage.setItem('universal_translator_api_key', e.target.value);
                    } catch (err) {}
                  }}
                  placeholder="AIzaSy..."
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 focus:outline-teal-500 text-xs font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Default free neural translation and Web Speech API work automatically without an API key.
                </p>
              </div>

              <div className="pt-1">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Tip: Tap the microphone button in the input card to speak in Urdu, English, or Punjabi. Natural text-to-speech audio is supported.
                </p>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2.5 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors mt-2 cursor-pointer"
              >
                Done (محفوظ کریں)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around p-3 shadow-2xl z-20">
        <button 
          onClick={() => setShowSettings(false)}
          className="flex flex-col items-center text-teal-600 transition-colors"
        >
          <Languages className="w-5 h-5" />
          <span className="text-xs font-bold mt-1">Translate</span>
        </button>
        <button 
          onClick={() => {
            setShowSettings(false);
            if (onOpenHistory) onOpenHistory();
          }}
          className="flex flex-col items-center text-gray-400 hover:text-gray-600 transition-colors"
        >
          <History className="w-5 h-5" />
          <span className="text-xs font-bold mt-1">History</span>
        </button>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`flex flex-col items-center transition-colors ${showSettings ? 'text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-xs font-bold mt-1">Settings</span>
        </button>
      </nav>
    </div>
  );
}
