export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="empty-state">
      <p className="eyebrow">Bluehour</p>
      <h1>{title}</h1>
      <p>Demo overview is the active workspace.</p>
    </section>
  );
}
