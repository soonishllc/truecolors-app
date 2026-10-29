import { STORE_LOGO } from "@/lib/brand";
import { siteImageUrl } from "@/lib/site-images";

// The Truecolors Design lockup drawn by the image model (npm run site:images -- wordmark): the store logo with
// DESIGN in sun-gradient line art underneath. Until it's made, the store logo with ".design" after it.
export function Wordmark() {
  const lockup = siteImageUrl("wordmark");
  if (lockup) return <img className="wordmark-lockup" src={lockup} alt="Truecolors Design" width={1393} height={435} />;
  return (
    <span className="wordmark">
      <img src={STORE_LOGO} alt="Truecolors" width={128} height={26} />
      <span className="wm-design"><i aria-hidden="true" />design</span>
    </span>
  );
}
