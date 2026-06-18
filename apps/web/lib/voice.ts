/**
 * Voice service — push-to-talk mode.
 * User taps to start speaking, taps again or silence to stop.
 * Uses native Web Speech API (STT) and ElevenLabs (TTS).
 */

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceConfig {
  onTranscript: (text: string, isFinal: boolean) => void;
  onTurnEnd: (transcript: string) => void;
  onError: (error: Error) => void;
  onStateChange: (state: VoiceState) => void;
  onPlaybackReady?: (playback: PlaybackSource) => void;
}

export interface PlaybackSource {
  url: string;
  mimeType: string;
}

// Global audio element for Safari — must warm up on user gesture
let audioWarmedUp = false;

export function warmUpAudio(): void {
  if (audioWarmedUp) return;
  const el = new Audio();
  const silentDataUri = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  el.src = silentDataUri;
  el.volume = 0.01;
  el.play().then(() => { audioWarmedUp = true; }).catch(() => {});
}

export class VoiceService {
  private config: VoiceConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private state: VoiceState = "idle";
  private finalTranscript = "";
  private interimTranscript = "";
  private silenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSpeechTime = 0;
  private readonly SILENCE_DURATION_MS = 2000;

  constructor(config: VoiceConfig) {
    this.config = config;
  }

  async startListening(): Promise<void> {
    warmUpAudio();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) throw new Error("Speech recognition not supported");

    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.finalTranscript = "";
    this.interimTranscript = "";

    this.recognition.onstart = () => {
      this.setState("listening");
      this.lastSpeechTime = Date.now();
      this.startSilenceDetection();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onresult = (event: any) => {
      this.lastSpeechTime = Date.now();
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) this.finalTranscript += final;
      this.interimTranscript = interim;
      this.config.onTranscript(this.finalTranscript + this.interimTranscript, !!final);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.config.onError(new Error(event.error));
    };

    this.recognition.onend = () => {
      this.clearSilenceTimeout();
      if (this.state === "listening" && this.finalTranscript.trim()) {
        this.endTurn();
      } else if (this.state === "listening") {
        this.setState("idle");
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    this.recognition.start();
  }

  stopListening(): void {
    this.clearSilenceTimeout();
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
  }

  private startSilenceDetection(): void {
    this.clearSilenceTimeout();
    const check = () => {
      if (this.state !== "listening") return;
      if (this.finalTranscript.trim() && Date.now() - this.lastSpeechTime > this.SILENCE_DURATION_MS) {
        this.stopListening();
        return;
      }
      this.silenceTimeout = setTimeout(check, 500);
    };
    this.silenceTimeout = setTimeout(check, 500);
  }

  private clearSilenceTimeout(): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
  }

  private endTurn(): void {
    const transcript = this.finalTranscript.trim();
    if (transcript) {
      this.setState("processing");
      this.config.onTurnEnd(transcript);
    } else {
      this.setState("idle");
    }
  }

  async speak(text: string): Promise<void> {
    this.setState("speaking");
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error(`TTS failed: ${response.status}`);

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("audio")) throw new Error("TTS returned non-audio response");

      const audioData = await response.arrayBuffer();
      if (audioData.byteLength < 100) throw new Error("TTS returned empty audio");

      const mimeType = contentType.split(";")[0].trim() || "audio/mpeg";
      const blob = new Blob([audioData], { type: mimeType });
      const url = URL.createObjectURL(blob);
      this.config.onPlaybackReady?.({ url, mimeType });
    } catch (error) {
      this.config.onError(error as Error);
    }
  }

  handlePlaybackComplete(): void { this.setState("idle"); }
  handlePlaybackStarted(): void { this.setState("speaking"); }
  handlePlaybackPaused(): void { this.setState("idle"); }
  handlePlaybackError(error: Error): void {
    this.config.onError(error);
    this.setState("idle");
  }

  private setState(state: VoiceState): void {
    this.state = state;
    this.config.onStateChange(state);
  }

  getState(): VoiceState { return this.state; }
}
