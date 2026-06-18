"use client";

import { useState, useCallback, useRef, useEffect, type RefObject } from "react";
import { VoiceService, VoiceState, type PlaybackSource } from "./voice";

interface UseVoiceOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onTurnEnd?: (transcript: string) => void;
  onError?: (error: Error) => void;
}

interface UseVoiceReturn {
  isListening: boolean;
  voiceState: VoiceState;
  currentTranscript: string;
  toggleListening: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  isSupported: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  playback: PlaybackState;
  togglePlayback: () => Promise<void>;
  seekTo: (nextTime: number) => void;
  setPlaybackRate: (nextRate: number) => void;
}

interface PlaybackState {
  sourceUrl: string | null;
  currentTime: number;
  duration: number;
  playbackRate: number;
  isPlaying: boolean;
}

const DEFAULT_PLAYBACK_RATE = 1;

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [playback, setPlayback] = useState<PlaybackState>({
    sourceUrl: null,
    currentTime: 0,
    duration: 0,
    playbackRate: DEFAULT_PLAYBACK_RATE,
    isPlaying: false,
  });
  const voiceServiceRef = useRef<VoiceService | null>(null);
  const optionsRef = useRef(options);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackUrlRef = useRef<string | null>(null);
  
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    
    setIsSupported(!!SpeechRecognition);
  }, []);

  // Create voice service on first use
  const getVoiceService = useCallback(() => {
    if (!voiceServiceRef.current) {
      voiceServiceRef.current = new VoiceService({
        onTranscript: (text, isFinal) => {
          setCurrentTranscript(text);
          optionsRef.current.onTranscript?.(text, isFinal);
        },
        onTurnEnd: (transcript) => {
          setCurrentTranscript("");
          optionsRef.current.onTurnEnd?.(transcript);
        },
        onError: (error) => {
          console.error("[useVoice] Error:", error);
          optionsRef.current.onError?.(error);
        },
        onStateChange: (state) => {
          console.log("[useVoice] State:", state);
          setVoiceState(state);
        },
        onPlaybackReady: ({ url }: PlaybackSource) => {
          audioRef.current?.pause();

          if (playbackUrlRef.current && playbackUrlRef.current !== url) {
            URL.revokeObjectURL(playbackUrlRef.current);
          }

          playbackUrlRef.current = url;
          setPlayback((current) => ({
            ...current,
            sourceUrl: url,
            currentTime: 0,
            duration: 0,
            isPlaying: false,
          }));
        },
      });
    }
    return voiceServiceRef.current;
  }, []);

  const toggleListening = useCallback(async () => {
    const service = getVoiceService();
    const currentState = service.getState();
    
    if (currentState === "listening") {
      // Stop listening
      service.stopListening();
    } else if (currentState === "idle") {
      // Start listening
      try {
        setCurrentTranscript("");
        await service.startListening();
      } catch (error) {
        console.error("[useVoice] Failed to start:", error);
        optionsRef.current.onError?.(error as Error);
      }
    }
    // If speaking or processing, ignore tap
  }, [getVoiceService]);

  const speak = useCallback(async (text: string) => {
    const service = getVoiceService();
    await service.speak(text);
  }, [getVoiceService]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !playback.sourceUrl) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        console.error("[useVoice] Failed to resume playback:", error);
        optionsRef.current.onError?.(error as Error);
      }
      return;
    }

    audio.pause();
  }, [playback.sourceUrl]);

  const seekTo = useCallback((nextTime: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedTime = Math.max(0, Math.min(nextTime, audio.duration || 0));
    audio.currentTime = clampedTime;
    setPlayback((current) => ({
      ...current,
      currentTime: clampedTime,
    }));
  }, []);

  const setPlaybackRate = useCallback((nextRate: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = nextRate;
    }

    setPlayback((current) => ({
      ...current,
      playbackRate: nextRate,
    }));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playback.sourceUrl) return;

    // The audio element needs to load the new source before playing.
    // Set src directly (in addition to React's render) and call load().
    audio.src = playback.sourceUrl;
    audio.load();

    const handleCanPlay = () => {
      audio.removeEventListener("canplay", handleCanPlay);
      audio.currentTime = 0;
      void audio.play().catch((error) => {
        console.error("[useVoice] Failed to autoplay playback:", error);
        optionsRef.current.onError?.(error as Error);
      });
    };

    audio.addEventListener("canplay", handleCanPlay);

    return () => {
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [playback.sourceUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = playback.playbackRate;
  }, [playback.playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setPlayback((current) => ({
        ...current,
        duration: audio.duration || 0,
      }));
    };

    const handleTimeUpdate = () => {
      setPlayback((current) => ({
        ...current,
        currentTime: audio.currentTime,
        duration: audio.duration || current.duration,
      }));
    };

    const handlePlay = () => {
      voiceServiceRef.current?.handlePlaybackStarted();
      setPlayback((current) => ({
        ...current,
        isPlaying: true,
      }));
    };

    const handlePause = () => {
      if (!audio.ended) {
        voiceServiceRef.current?.handlePlaybackPaused();
      }
      setPlayback((current) => ({
        ...current,
        isPlaying: false,
      }));
    };

    const handleEnded = () => {
      setPlayback((current) => ({
        ...current,
        isPlaying: false,
        currentTime: current.duration,
      }));
      voiceServiceRef.current?.handlePlaybackComplete();
    };

    const handleError = () => {
      const mediaError = audio.error;
      const errorDetail = mediaError
        ? `code=${mediaError.code} message=${mediaError.message}`
        : "no MediaError";
      console.error("[useVoice] Audio element error:", errorDetail, "src:", audio.src?.slice(0, 50), "networkState:", audio.networkState, "readyState:", audio.readyState);
      voiceServiceRef.current?.handlePlaybackError(new Error(`Playback failed: ${errorDetail}`));
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [playback.sourceUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceServiceRef.current) {
        voiceServiceRef.current.stopListening();
      }
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
        playbackUrlRef.current = null;
      }
    };
  }, []);

  return {
    isListening: voiceState === "listening",
    voiceState,
    currentTranscript,
    toggleListening,
    speak,
    isSupported,
    audioRef,
    playback,
    togglePlayback,
    seekTo,
    setPlaybackRate,
  };
}
