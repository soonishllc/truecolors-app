import { WebScreen } from "@/components/WebScreen";
import { APP } from "@/lib/site";

// Design your own: what it is and how to start, or straight to a new design for someone already designing. A
// sketch can come from the camera or the photo library; the page's file picker offers both.
export default function Create() {
  return <WebScreen url={`${APP}/join`} tabRoot />;
}
