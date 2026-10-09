import { useEffect, useRef, useState } from "react";
import { NEUTRAL, PRESETS, isNeutral, type Adjust } from "../image/adjust";
import { loadImage, renderAdjusted, renderFinal, type FinalImage } from "../image/render";
import { Modal } from "./Panels";

/** Non-destructive-feeling image editor: tweak, preview live, apply (one undo step restores the original). */
export function ImageEditor({ src, mime, onApply, onClose }: { src: string; mime: string; onApply: (r: FinalImage) => void; onClose: () => void }) {
  const [p, setP] = useState<Adjust>(NEUTRAL);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  useEffect(() => void loadImage(src).then(setImg), [src]);
  useEffect(() => {
    if (!img || !view.current) return;
    const id = requestAnimationFrame(() => {
      const c = renderAdjusted(img, p, 560);
      const v = view.current!;
      v.width = c.width;
      v.height = c.height;
      v.getContext("2d")!.drawImage(c, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [img, p]);

  const set = (patch: Partial<Adjust>) => setP((q) => ({ ...q, ...patch }));
  const slider = (label: string, key: "brightness" | "contrast" | "saturation" | "blur", min: number, max: number) => (
    <label className="sl">
      <span>
        {label} <b>{p[key]}</b>
      </span>
      <input type="range" min={min} max={max} value={p[key]} onChange={(e) => set({ [key]: +e.target.value } as Partial<Adjust>)} data-testid={`adj-${key}`} />
    </label>
  );
  const apply = async () => {
    if (!img) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 20));
    onApply(renderFinal(img, p, mime));
  };
  return (
    <Modal title="Edit image" onClose={onClose} wide>
      <div className="imged" data-testid="image-editor">
        <div className="stage">
          <canvas ref={view} data-testid="image-preview" />
        </div>
        <div className="controls">
          <div className="presets">
            {Object.entries(PRESETS).map(([name, v]) => (
              <button key={name} className="btn small" onClick={() => setP({ ...NEUTRAL, ...v, rotate: p.rotate, flipH: p.flipH, flipV: p.flipV })} data-testid={`preset-${name}`}>
                {name}
              </button>
            ))}
          </div>
          {slider("Brightness", "brightness", -100, 100)}
          {slider("Contrast", "contrast", -100, 100)}
          {slider("Saturation", "saturation", -100, 100)}
          {slider("Blur", "blur", 0, 20)}
          <label className="check">
            <input type="checkbox" checked={p.bgTolerance !== null} onChange={(e) => set({ bgTolerance: e.target.checked ? 24 : null })} data-testid="adj-bg" />
            Remove background <span className="mut">(plain backdrop around the subject)</span>
          </label>
          {p.bgTolerance !== null && (
            <label className="sl">
              <span>
                Tolerance <b>{p.bgTolerance}</b>
              </span>
              <input type="range" min={2} max={60} value={p.bgTolerance} onChange={(e) => set({ bgTolerance: +e.target.value })} data-testid="adj-bgtol" />
            </label>
          )}
          <div className="presets">
            <button className="btn small" onClick={() => set({ rotate: (((p.rotate + 90) % 360) as Adjust["rotate"]) })} data-testid="adj-rotate">
              ⟳ Rotate
            </button>
            <button className="btn small" onClick={() => set({ flipH: !p.flipH })}>
              ↔ Flip
            </button>
            <button className="btn small" onClick={() => set({ flipV: !p.flipV })}>
              ↕ Flip
            </button>
            <button className="btn small" onClick={() => setP(NEUTRAL)}>
              Reset
            </button>
          </div>
        </div>
      </div>
      <footer className="form-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!img || busy || isNeutral(p)} onClick={apply} data-testid="adj-apply">
          {busy ? "Applying…" : "Apply to canvas"}
        </button>
      </footer>
    </Modal>
  );
}
