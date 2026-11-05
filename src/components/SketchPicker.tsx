"use client";

import { useEffect, useRef, useState } from "react";

// The optional sketch on a new design: pick a photo or scan from the gallery (or take one), see it, remove it.
export function SketchPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; name: string }>();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPreview(file ? { url: URL.createObjectURL(file), name: file.name } : undefined);
  };
  const remove = () => {
    if (input.current) input.current.value = "";
    setPreview(undefined);
  };

  return (
    <div className={`sketch-picker${preview ? " has" : ""}`}>
      <label className="dropzone">
        <input ref={input} type="file" name="sketch" accept="image/*" onChange={pick} />
        {preview ? (
          <span className="sketch-chosen">
            <img src={preview.url} alt="Your sketch" />
            <span><b>Sketch added</b><span className="small muted">{preview.name}</span></span>
          </span>
        ) : (
          <>
            <span className="dz-title">✎ Add a sketch (optional)</span>
            <span className="small muted">A photo or scan of a drawing. The AI keeps your idea and redraws it cleanly.</span>
          </>
        )}
      </label>
      {preview && <button type="button" className="link small" onClick={remove}>Remove sketch</button>}
    </div>
  );
}

// A text box with a live character count, so a long idea isn't cut off without warning.
export function CountedText({ name, max, rows, placeholder, required }: {
  name: string; max: number; rows?: number; placeholder?: string; required?: boolean;
}) {
  const [n, setN] = useState(0);
  return (
    <span className="counted">
      <textarea name={name} maxLength={max} rows={rows} placeholder={placeholder} required={required} onChange={(e) => setN(e.target.value.length)} />
      <span className={`small counter${n > max * 0.9 ? " near" : ""}`}>{n}/{max}</span>
    </span>
  );
}
