import { Component, type ErrorInfo, type ReactNode } from "react";
import { Banner, Button } from "./ui";

/**
 * REAL GAP found by the 2026-09-11 SPA Readiness Assessment: zero
 * occurrences of ErrorBoundary/componentDidCatch anywhere in this app —
 * an uncaught exception in any single page (a null the code didn't
 * anticipate, a third-party quirk) unmounted the entire React tree to a
 * blank page, with no visible recovery path.
 *
 * Placed around <Outlet/> in Layout.tsx (not around the whole app in
 * App.tsx) so a crash inside one page's content leaves the sidebar and
 * navigation intact — a real, working way out ("go to Snapshot") instead
 * of a full white screen the only fix for is a manual browser reload.
 * "Try again" re-renders the SAME route: useful for a transient failure
 * (a network blip mid-render), and harmless when it isn't — clicking it
 * twice on a genuinely broken page just shows the same fallback again.
 *
 * A class component is not a stylistic choice here — getDerivedStateFromError
 * and componentDidCatch have no stable hook equivalent in this React
 * version; this is the one place in the app that has to be a class.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error-reporting service wired up anywhere in this app yet (a
    // real, disclosed gap, not a silent omission) — console.error is the
    // one place this failure is actually visible today.
    console.error("Unhandled error in page content:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 480 }}>
          <Banner kind="error">Something went wrong rendering this page.</Banner>
          <p style={{ color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <Button variant="primary" onClick={this.reset}>
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                this.reset();
                window.location.assign("/");
              }}
            >
              Go to Snapshot
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
