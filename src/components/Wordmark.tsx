/** Lowercase "paid" with a periwinkle square where the dot of the "i" would be. */
export function Wordmark({ className = "text-[38px]" }: { className?: string }) {
  return (
    <span className={`inline-block leading-none font-black tracking-[-0.06em] select-none ${className}`} role="img" aria-label="paid">
      <span aria-hidden="true">
        pa
        <span className="relative inline-block">
          ı
          <span className="absolute top-[0.07em] left-[46%] size-[0.19em] -translate-x-1/2 rounded-[1px] bg-accent-deep" />
        </span>
        d
      </span>
    </span>
  );
}
