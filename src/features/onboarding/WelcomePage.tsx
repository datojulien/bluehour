import { Database, Landmark } from "lucide-react";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";

export function WelcomePage() {
  const { loading, error, shellState, exploreDemo, startLiveSetup } = useBluehourData();

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
            Choose a fictional demonstration profile or create a separate live profile. The app code is public static web code; your
            financial Sheet is private to your Google account when you connect one.
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
          <button className="choice-button primary-choice" type="button" onClick={() => void startLiveSetup()}>
            <Landmark size={22} aria-hidden="true" />
            <span>
              <strong>Set up my finances</strong>
              <small>Create an empty live profile with today's local date.</small>
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}
