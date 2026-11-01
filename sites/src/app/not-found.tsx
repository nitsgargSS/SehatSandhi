export default function NotFound() {
  return (
    <div className="sn" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="stack" style={{ gap: 12, textAlign: 'center' }}>
        <h1 style={{ fontSize: 32 }}>Page not found</h1>
        <p className="muted">यह पेज नहीं मिला।</p>
        <a className="btn btn-primary" href="/" style={{ alignSelf: 'center' }}>Home</a>
      </div>
    </div>
  );
}
