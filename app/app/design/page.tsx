import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "./design-showcase";

/**
 * Dev-only reference for every design token and shared component
 * (app/components/ui, app/components/tt). Deliberately not linked from the
 * app shell's sidebar or anywhere else in the app - find it by URL in
 * development. 404s in production so it never becomes a real, discoverable
 * route.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <DesignSystemShowcase />;
}
