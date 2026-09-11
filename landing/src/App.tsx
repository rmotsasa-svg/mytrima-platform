import { Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import { HomePage } from "./pages/HomePage";
import { AboutPage } from "./pages/AboutPage";
import { SolutionPage } from "./pages/SolutionPage";
import { PackagesPage } from "./pages/PackagesPage";
import { SuccessStoriesPage } from "./pages/SuccessStoriesPage";
import { ContactPage } from "./pages/ContactPage";
import "./App.css";

const TITLES: Record<string, string> = {
  "/": "Mytrima — Built for how you grow",
  "/about": "About us — Mytrima",
  "/solution": "Our solution — Mytrima",
  "/packages": "Packages — Mytrima",
  "/success-stories": "Success stories — Mytrima",
  "/contact": "Contact — Mytrima",
};

/** No SSR here (see landing/README.md's own disclosed gap), so a per-page
 * <title> has to be set on the client — this is the one place that needs
 * to happen, rather than every page component duplicating it.
 *
 * REAL BUG found live-verifying the Contact page's "the signup form" link
 * (/#signup): the browser's own native anchor-scroll races this app's own
 * render — on first load of a URL with a hash, the browser tries to
 * scroll to that id before React has mounted HomePage's content at all,
 * finds nothing, and gives up; it doesn't retry once the element actually
 * appears. Same root cause on an in-app <Link to="/#signup"> navigation
 * from another page — react-router swaps the route's content but does
 * nothing with the hash on its own. Fixed by doing the scroll ourselves,
 * on a rAF after the new route's content has actually painted, using
 * `location.hash` (not tracked by `location.pathname` alone, which is why
 * this needed its own effect dependency). */
function useDocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    document.title = TITLES[location.pathname] ?? TITLES["/"];
    const hash = location.hash.replace(/^#/, "");
    requestAnimationFrame(() => {
      const target = hash ? document.getElementById(hash) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo(0, 0);
      }
    });
  }, [location.pathname, location.hash]);
}

function Shell() {
  useDocumentTitle();
  return (
    <div className="page">
      <Nav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/solution" element={<SolutionPage />} />
        <Route path="/packages" element={<PackagesPage />} />
        <Route path="/success-stories" element={<SuccessStoriesPage />} />
        <Route path="/contact" element={<ContactPage />} />
      </Routes>
      <Footer />
    </div>
  );
}

export function App() {
  return <Shell />;
}
