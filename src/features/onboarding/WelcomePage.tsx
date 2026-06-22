import { useEffect } from "react";
import { Database, KeyRound, Landmark } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";

export function WelcomePage() {
  const { loading, error, shellState, exploreDemo, startLiveSetup, startGoogleRecovery } = useBluehourData();

  useEffect(() => {
    if (/^#connect=[a-zA-Z0-9-_]+/.test(window.location.hash)) {
      void startGoogleRecovery();
    }
  }, [startGoogleRecovery]);

  if (loading) {
    return <div className="loading-state full-page-state">Opening Bluehour…</div>;
  }

  return (
    <main className="welcome-screen">
      <section className="welcome-panel">
        <div className="welcome-copy">
          <p className="eyebrow">Bluehour</p>
          <h1>Personal cash-flow planning for MYR salary cycles</h1>
          <p>
            Sign in with Google to sync a private Drive vault across browsers, or explore a separate fictional demonstration profile.
          </p>
        </div>

        {error ? <div className="alert-band danger">{error}</div> : null}
        {shellState?.legacyDatabaseDetected ? (
          <div className="alert-band">
            A legacy local database was detected. It will stay untouched unless you explicitly import it from Settings.
          </div>
        ) : null}

        <div className="choice-grid">
          <button className="choice-button" type="button" onClick={() => void exploreDemo()}>
            <Database size={22} aria-hidden="true" />
            <span>
              <strong>Explore demonstration</strong>
              <small>Open isolated fictional MYR data with a fixed demo date.</small>
            </span>
          </button>
          <button className="choice-button primary-choice" type="button" onClick={() => void startGoogleRecovery()}>
            <KeyRound size={22} aria-hidden="true" />
            <span>
              <strong>Continue with Google</strong>
              <small>Sign in and open your hidden Google Drive Bluehour vault.</small>
            </span>
          </button>
          <button className="choice-button" type="button" onClick={() => void startLiveSetup()}>
            <Landmark size={22} aria-hidden="true" />
            <span>
              <strong>Set up locally first</strong>
              <small>Create an empty local live profile and connect Google later.</small>
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}
