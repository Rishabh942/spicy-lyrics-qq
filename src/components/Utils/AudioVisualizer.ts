import { getDynamicAudioAnalysis } from "../../utils/audioAnalysis.ts";
import type { AudioAnalysisData } from "../DynamicBG/BackgroundAnimationController.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";

export class AudioVisualizer {
    private element: HTMLElement;
    private wrapper: HTMLElement;
    private analysisData: AudioAnalysisData | null = null;
    private currentUri: string = "";
    private updateInterval: number | null = null;
    private readonly numBars = 45;
    
    private smoothedPitches: number[] = new Array(45).fill(0.1);
    private smoothedLoudness: number = 0;

    constructor() {
        this.element = document.createElement("div");
        this.element.classList.add("AudioVisualizer");
        
        const barsHtml = Array.from({length: this.numBars}).map((_, i) => 
            `<div class="WaveformBar" id="vb-${i}" style="--bar-index: ${i}; transform: scaleY(var(--p${i}, 0.1));"></div>`
        ).join('');
        
        this.element.innerHTML = `
            <div class="WaveformWrapper Played" style="clip-path: none; --SliderProgress: 1;">
                ${barsHtml}
            </div>
        `;
        this.wrapper = this.element.querySelector(".WaveformWrapper") as HTMLElement;
    }

    public GetElement() {
        return this.element;
    }

    public async Apply() {
        this.startLoop();
        this.currentUri = SpotifyPlayer.GetUri() || "";
        this.analysisData = await getDynamicAudioAnalysis(this.currentUri);
        
        Spicetify.Player.addEventListener("songchange", this.onSongChange);
    }

    public CleanUp() {
        this.stopLoop();
        Spicetify.Player.removeEventListener("songchange", this.onSongChange);
    }

    private onSongChange = async () => {
        const uri = SpotifyPlayer.GetUri();
        if (uri && uri !== this.currentUri) {
            this.currentUri = uri;
            // Clear current data
            this.analysisData = null;
            this.smoothedPitches.fill(0.1);
            this.smoothedLoudness = 0;
            this.updateDOM();
            
            this.analysisData = await getDynamicAudioAnalysis(uri);
        }
    }

    private startLoop() {
        if (this.updateInterval !== null) return;
        // Run at ~30-60fps
        this.updateInterval = window.setInterval(() => this.update(), 30) as unknown as number;
    }

    private stopLoop() {
        if (this.updateInterval !== null) {
            window.clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private update() {
        if (!this.analysisData || !this.analysisData.segments || !Spicetify.Player.isPlaying()) {
            // Decay to 0 when paused or loading
            this.smoothedLoudness += (0 - this.smoothedLoudness) * 0.1;
            for (let i = 0; i < this.numBars; i++) {
                this.smoothedPitches[i] += (0.1 - this.smoothedPitches[i]) * 0.1;
            }
            this.updateDOM();
            return;
        }

        const currentTime = (SpotifyPlayer.GetPosition() || 0) / 1000;
        const segment = this.analysisData.segments.find(s => 
            currentTime >= s.start && currentTime < (s.start + s.duration)
        );

        if (!segment) return;

        // Map loudness (-60 to 0) to a multiplier (0 to 1)
        const loudnessNorm = Math.max(0, Math.min(1, (segment.loudness_max + 60) / 60));
        this.smoothedLoudness += (loudnessNorm - this.smoothedLoudness) * 0.2;

        const pitches = segment.pitches || new Array(12).fill(0.1);
        
        for (let i = 0; i < this.numBars; i++) {
            // Map 0-44 to 0-11
            const pitchIdx = (i / (this.numBars - 1)) * 11;
            const lower = Math.floor(pitchIdx);
            const upper = Math.ceil(pitchIdx);
            const weight = pitchIdx - lower;
            
            const pLower = pitches[lower] || 0.1;
            const pUpper = pitches[upper] || 0.1;
            
            let val = pLower * (1 - weight) + pUpper * weight;
            
            // Bass boost for lower bars based on overall loudness
            if (i < 12) {
                const bassWeight = 1 - i/12;
                val = val * (1 + bassWeight * loudnessNorm * 1.2);
                
                // Subbass floor: if the track is loud/grungy but pitch data drops the bass, 
                // maintain a rumbling floor so it doesn't look flat.
                const subbassFloor = (loudnessNorm * 0.6) * bassWeight;
                val = Math.max(val, subbassFloor);
            }
            
            // Exaggerate peaks
            val = Math.pow(val, 1.5);
            
            val = Math.max(0.1, Math.min(1.5, val)); // allow a bit higher than 1.0 for huge spikes
            
            // Fast attack, slower release for a snappy visualizer feel
            const diff = val - this.smoothedPitches[i];
            
            let attack = 0.4;
            let release = 0.15;
            
            // Subbass tends to linger. Give lower bars a much slower release.
            if (i < 12) {
                release = 0.04 + (i / 12) * 0.11; // 0.04 to 0.15 depending on how low it is
            }
            
            const smoothFactor = diff > 0 ? attack : release;
            this.smoothedPitches[i] += diff * smoothFactor;
        }
        
        this.updateDOM();
    }
    
    private updateDOM() {
        this.wrapper.style.setProperty("--loudness", this.smoothedLoudness.toString());
        for (let i = 0; i < this.numBars; i++) {
            this.wrapper.style.setProperty(`--p${i}`, this.smoothedPitches[i].toFixed(3));
        }

        // Update Track Metrics and Timbre if available
        const trackMetricsContainer = document.querySelector("#SpicyLyricsPage .ContentBox .NowBar .Header .Metadata .TrackMetrics") as HTMLElement;
        if (!trackMetricsContainer) return;

        if (!this.analysisData || !this.analysisData.segments || !Spicetify.Player.isPlaying()) {
            trackMetricsContainer.style.opacity = "0";
            return;
        }
        
        trackMetricsContainer.style.opacity = "1";

        const currentTime = (SpotifyPlayer.GetPosition() || 0) / 1000;
        const segment = this.analysisData.segments.find(s => 
            currentTime >= s.start && currentTime < (s.start + s.duration)
        );
        const section = this.analysisData.sections.find(s => 
            currentTime >= s.start && currentTime < (s.start + s.duration)
        );

        if (section) {
            const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            const keyStr = section.key >= 0 && section.key < 12 ? keys[section.key] : "?";
            const modeStr = section.mode === 0 ? "Minor" : "Major";
            
            const newTempo = `${Math.round(section.tempo)} BPM`;
            const newKey = `${keyStr} ${modeStr}`;
            const newSig = `${section.time_signature}/4`;

            const triggerAnimation = (el: Element | null, newVal: string) => {
                if (!el) return;
                if (el.textContent !== newVal) {
                    el.textContent = newVal;
                    // Trigger reflow to restart animation
                    el.classList.remove("Changed");
                    void (el as HTMLElement).offsetWidth; 
                    el.classList.add("Changed");
                    
                    // Remove class after animation completes (600ms)
                    setTimeout(() => el.classList.remove("Changed"), 600);
                }
            };

            triggerAnimation(trackMetricsContainer.querySelector("#MetricTempo"), newTempo);
            triggerAnimation(trackMetricsContainer.querySelector("#MetricKey"), newKey);
            triggerAnimation(trackMetricsContainer.querySelector("#MetricSig"), newSig);
        }

        if (segment && segment.timbre) {
            const timbreBlocks = trackMetricsContainer.querySelectorAll(".TimbreBlock");
            segment.timbre.forEach((t, i) => {
                if (timbreBlocks[i]) {
                    // Timbre values range drastically depending on the coefficient, usually -100 to 100
                    const norm = Math.max(0, Math.min(1, (t + 50) / 100)); 
                    (timbreBlocks[i] as HTMLElement).style.setProperty("--t-val", norm.toString());
                }
            });
        }
    }
}
