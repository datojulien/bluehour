import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Bluehour recovered from a UI error", {
      message: error.message,
      componentStack: info.componentStack
    });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="welcome-screen">
          <section className="empty-state">
            <p className="eyebrow">Recovery</p>
            <h1>Bluehour could not open this view</h1>
            <p>{this.state.error.message}</p>
            <button className="primary-action" type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
