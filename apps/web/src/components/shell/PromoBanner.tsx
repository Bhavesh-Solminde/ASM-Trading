export function PromoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1a7f52] to-[#2fbd85] px-4 py-1.5">
      <span aria-hidden>🚀</span>
      <p className="text-xs font-semibold text-white">
        Get a <span className="font-bold">50% bonus</span> on your deposit!
      </p>
      <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold text-white">50%</span>
    </div>
  );
}
