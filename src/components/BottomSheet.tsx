"use client";

// Phones: the side panel sits far below the chat, so a tapped word opens its
// step here instead. Closes on backdrop tap, a downward swipe or Escape.

import { useEffect, useRef } from "react";

export default function BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) onClose();
          startY.current = null;
        }}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn link" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
