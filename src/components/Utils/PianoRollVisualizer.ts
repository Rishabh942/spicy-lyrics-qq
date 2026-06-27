import { getDynamicAudioAnalysis, AudioAnalysisData } from "../../utils/audioAnalysis.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";

export class PianoRollVisualizer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private analysisData: AudioAnalysisData | null = null;
    private currentUri: string = "";
    private animationFrameId: number | null = null;
    private isRunning: boolean = false;
    private trackBaseColor: string = "0, 0%, 100%";
    
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
        if (rect && rect.width > 0 && rect.height > 0) {
            this.canvas.width = Math.floor(rect.width * dpr);
            this.canvas.height = Math.floor(rect.height * dpr);
            // We shouldn't use scale() here if we want to manually scale coords, or we just rely on it.
            // Actually, scaling the context is fine, but we have to re-apply it after setting width/height!
            this.ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
            this.ctx.scale(dpr, dpr);
            this.canvas.style.width = `${rect.width}px`;
            this.canvas.style.height = `${rect.height}px`;
        }
    };

    public async Apply() {
        this.isRunning = true;
        this.currentUri = SpotifyPlayer.GetUri() || "";
        this.analysisData = await getDynamicAudioAnalysis(this.currentUri);
        this.updateTrackColor();
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
            this.updateTrackColor();
        }
    };

    private async updateTrackColor() {
        this.trackBaseColor = "0, 0%, 100%";
        try {
            const imgUrl = SpotifyPlayer.GetCover("large") ?? "";
            if (!imgUrl) return;

            const colorQuery = await Spicetify.GraphQL.Request(
                Spicetify.GraphQL.Definitions.getDynamicColorsByUris,
                { imageUris: [imgUrl] }
            );
            
            const colorResponse = colorQuery.data.dynamicColors[0];
            const colorBestFit = colorResponse.bestFit === "DARK" ? "dark" : colorResponse.bestFit === "LIGHT" ? "light" : "dark";
            const minContrastObj = colorResponse[colorBestFit].minContrast.backgroundBase;
            
            let r = minContrastObj.red / 255;
            let g = minContrastObj.green / 255;
            let b = minContrastObj.blue / 255;
            
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h = 0, s = 0, l = (max + min) / 2;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            h = (h + 0.5) % 1; // Opposite hue
            s = Math.max(s, 0.75); // Vibrant
            l = 0.65; // Pleasant lightness
            this.trackBaseColor = `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
        } catch (e) {
            console.error("Failed to fetch track colors for PianoRoll:", e);
        }
    }

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
        if (!rect || rect.width === 0 || rect.height === 0) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        
        const dpr = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.floor(rect.width * dpr) || this.canvas.height !== Math.floor(rect.height * dpr)) {
            this.resize();
        }

        const width = rect.width;
        const height = rect.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);
        
        if (!this.analysisData || !this.analysisData.segments) return;

        const currentTime = Spicetify.Player.getProgress() / 1000;
        const endTime = currentTime + this.lookAheadSeconds;

        const laneWidth = width / 12;
        const playAreaTop = height * 0.25; // 25% padding at the top
        const playAreaBottom = height * 0.82; // 18% padding at the bottom
        const playAreaHeight = playAreaBottom - playAreaTop;

        const baseColor = this.trackBaseColor;

        // Draw hit line (strike line)
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        this.ctx.fillRect(0, playAreaBottom - 2, width, 2);
        this.ctx.shadowBlur = 0;

        // Draw grid lines with gradient so they fade at top
        const gridGrad = this.ctx.createLinearGradient(0, 0, 0, playAreaBottom);
        gridGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
        gridGrad.addColorStop(1, "rgba(255, 255, 255, 0.08)");
        
        this.ctx.lineWidth = 1;
        this.ctx.font = "600 13px system-ui, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "top"; // Change baseline since they are below strike line
        
        for (let i = 0; i < 12; i++) {
            this.ctx.strokeStyle = gridGrad;
            this.ctx.beginPath();
            this.ctx.moveTo(i * laneWidth, 0);
            this.ctx.lineTo(i * laneWidth, playAreaBottom);
            this.ctx.stroke();
            
            // Draw note label below the strike line
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
            this.ctx.fillText(this.notes[i], i * laneWidth + laneWidth / 2, playAreaBottom + 12);
        }

        const segments = this.analysisData.segments;
        let startIndex = 0;
        for (let i = 0; i < segments.length; i++) {
            if (segments[i].start + segments[i].duration > currentTime) {
                startIndex = i;
                break;
            }
        }

        for (let i = startIndex; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.start > endTime) break; 

            const yBottom = playAreaBottom - ((seg.start - currentTime) / this.lookAheadSeconds) * playAreaHeight;
            const yTop = playAreaBottom - (((seg.start + seg.duration) - currentTime) / this.lookAheadSeconds) * playAreaHeight;
            
            if (yTop >= playAreaBottom) continue; // Note is completely below the strike line

            const clampedYBottom = Math.min(yBottom, playAreaBottom);
            const segHeight = Math.max(clampedYBottom - yTop, 4); 

            // Filter top 2 most dominant pitches above threshold to reduce noise
            const dominantPitches = Array.from({ length: 12 }, (_, p) => ({ pitch: p, intensity: seg.pitches[p] }))
                .filter(p => p.intensity > 0.75)
                .sort((a, b) => b.intensity - a.intensity)
                .slice(0, 2);

            for (const { pitch: p, intensity: pitchIntensity } of dominantPitches) {
                    const opacity = Math.min(pitchIntensity * 1.5, 0.85); // slightly lowered max opacity
                    const isHitting = yBottom >= playAreaBottom && yTop <= playAreaBottom;

                    // Gradient for the note using the opposite background color
                    const noteGrad = this.ctx.createLinearGradient(0, yTop, 0, clampedYBottom);
                    noteGrad.addColorStop(0, `hsla(${baseColor}, ${opacity * 0.4})`);
                    noteGrad.addColorStop(1, `hsla(${baseColor}, ${opacity})`);

                    this.ctx.fillStyle = noteGrad;
                    
                    // Add glow if it's currently hitting the strike line
                    if (isHitting) {
                        this.ctx.shadowBlur = 15;
                        this.ctx.shadowColor = `hsla(${baseColor}, 0.8)`;
                    } else {
                        this.ctx.shadowBlur = 0;
                    }

                    const padding = laneWidth * 0.1;
                    const rectX = p * laneWidth + padding;
                    const rectW = laneWidth - padding * 2;
                    const radius = Math.min(rectW / 4, 6);

                    // Draw rounded rectangle
                    this.ctx.beginPath();
                    if (typeof this.ctx.roundRect === 'function') {
                        this.ctx.roundRect(rectX, yTop, rectW, segHeight, radius);
                    } else {
                        // Fallback
                        this.ctx.rect(rectX, yTop, rectW, segHeight);
                    }
                    this.ctx.fill();

                    // Draw bright leading edge
                    this.ctx.fillStyle = `hsla(${baseColor}, ${Math.min(opacity * 1.2, 1)})`;
                    this.ctx.beginPath();
                    if (typeof this.ctx.roundRect === 'function') {
                        this.ctx.roundRect(rectX, clampedYBottom - 4, rectW, 4, [0, 0, radius, radius]);
                    } else {
                        this.ctx.rect(rectX, clampedYBottom - 4, rectW, 4);
                    }
                    this.ctx.fill();
                    
                    // Reset shadow
                    this.ctx.shadowBlur = 0;
            }
        }
    }
}
