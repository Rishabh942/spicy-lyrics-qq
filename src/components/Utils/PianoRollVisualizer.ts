import { getDynamicAudioAnalysis, AudioAnalysisData } from "../../utils/audioAnalysis.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";

export class PianoRollVisualizer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private analysisData: AudioAnalysisData | null = null;
    private currentUri: string = "";
    private animationFrameId: number | null = null;
    private isRunning: boolean = false;
    
    // Viewport settings
    private lookAheadSeconds: number = 5.0; // Draw 5 seconds into the future
    private notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not get 2D context");
        this.ctx = context;
        this.resize();
        window.addEventListener("resize", this.resize);
    }
    
    private resize = () => {
        // Adjust canvas resolution for high DPI displays
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.parentElement?.getBoundingClientRect();
        if (rect) {
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.ctx.scale(dpr, dpr);
            this.canvas.style.width = `${rect.width}px`;
            this.canvas.style.height = `${rect.height}px`;
        }
    };

    public async Apply() {
        this.isRunning = true;
        this.currentUri = SpotifyPlayer.GetUri() || "";
        this.analysisData = await getDynamicAudioAnalysis(this.currentUri);
        Spicetify.Player.addEventListener("songchange", this.onSongChange);
        this.startLoop();
    }

    public CleanUp() {
        this.isRunning = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        Spicetify.Player.removeEventListener("songchange", this.onSongChange);
        window.removeEventListener("resize", this.resize);
    }

    private onSongChange = async () => {
        const uri = SpotifyPlayer.GetUri();
        if (uri && uri !== this.currentUri) {
            this.currentUri = uri;
            this.analysisData = null;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.analysisData = await getDynamicAudioAnalysis(uri);
        }
    };

    private startLoop() {
        const loop = () => {
            if (!this.isRunning) return;
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        this.animationFrameId = requestAnimationFrame(loop);
    }

    private render() {
        const rect = this.canvas.parentElement?.getBoundingClientRect();
        if (!rect) return;
        const { width, height } = rect;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);
        
        if (!this.analysisData || !this.analysisData.segments) return;

        const currentTime = Spicetify.Player.getProgress() / 1000;
        const endTime = currentTime + this.lookAheadSeconds;

        const laneWidth = width / 12;

        // Draw lane separators and note labels
        this.ctx.lineWidth = 1;
        this.ctx.font = "14px system-ui, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "bottom";
        
        for (let i = 0; i < 12; i++) {
            this.ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            this.ctx.beginPath();
            this.ctx.moveTo(i * laneWidth, 0);
            this.ctx.lineTo(i * laneWidth, height);
            this.ctx.stroke();
            
            // Draw note label at the bottom
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            this.ctx.fillText(this.notes[i], i * laneWidth + laneWidth / 2, height - 10);
        }

        // Find segments that fall within our viewport [currentTime, endTime]
        const segments = this.analysisData.segments;
        
        // Optimize: binary search could be used, but since it's a few hundred segments, linear is okay for now
        // Find first segment
        let startIndex = 0;
        for (let i = 0; i < segments.length; i++) {
            if (segments[i].start + segments[i].duration > currentTime) {
                startIndex = i;
                break;
            }
        }

        for (let i = startIndex; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.start > endTime) break; // Out of viewport

            // Calculate Y positions (falling downwards: top is future, bottom is current)
            // If seg.start == currentTime, Y = height.
            // If seg.start == endTime, Y = 0.
            const yBottom = height - ((seg.start - currentTime) / this.lookAheadSeconds) * height;
            const yTop = height - (((seg.start + seg.duration) - currentTime) / this.lookAheadSeconds) * height;
            
            const segHeight = Math.max(yBottom - yTop, 2); // Minimum 2px height

            // For each of the 12 pitches, draw a block if intensity is high
            for (let p = 0; p < 12; p++) {
                const pitchIntensity = seg.pitches[p];
                if (pitchIntensity > 0.6) { // Threshold for "note is active"
                    // Color based on intensity and pitch
                    // Map 12 pitches to hues (0-360)
                    const hue = (p * 30) % 360;
                    const opacity = Math.min(pitchIntensity * 1.5, 1);
                    this.ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${opacity})`;
                    
                    // Draw block with a little padding
                    const padding = 2;
                    this.ctx.fillRect(p * laneWidth + padding, yTop, laneWidth - padding * 2, segHeight);
                    
                    // Optional: draw brighter tip at the start of the note (bottom edge of the block)
                    this.ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${opacity})`;
                    this.ctx.fillRect(p * laneWidth + padding, yBottom - 2, laneWidth - padding * 2, 2);
                }
            }
        }
    }
}
