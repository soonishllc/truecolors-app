// The Truecolors store logo with a minimal ".design" after it, read as the domain. The dot is the sun's orange.
export function Wordmark() {
  return (
    <span className="wordmark">
      <img src="/site/truecolors-logo.png" alt="Truecolors" width={600} height={82} />
      <span className="wm-design"><span className="wm-dot">.</span>design</span>
    </span>
  );
}
