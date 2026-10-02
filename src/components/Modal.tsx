"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * A modal on the native <dialog>: the browser traps focus, closes on
 * Escape, and returns focus to the control that opened it.
 */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-[28px] leading-none font-black tracking-[-0.04em]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-2 -mr-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-line/60"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 4l12 12M16 4L4 16" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
