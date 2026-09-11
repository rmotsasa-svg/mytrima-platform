import { Link } from "react-router-dom";

type ChartVariant = "bars" | "line" | "donut";

/** Illustrative only — a visual motif for the growth theme, not a chart of
 * real data. Deliberately abstract (no axis labels, no numbers presented
 * as real figures) so nothing here could be mistaken for an actual
 * customer's results. */
function Chart({ variant }: { variant: ChartVariant }) {
  if (variant === "bars") {
    return (
      <svg viewBox="0 0 160 110" width="100%" height="100%" role="img" aria-label="Illustrative bar chart trending upward">
        <line x1="10" y1="95" x2="150" y2="95" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        {[24, 38, 30, 52, 46, 68, 84].map((h, i) => (
          <rect key={i} x={14 + i * 20} y={95 - h} width="12" height={h} rx="2" fill={i === 6 ? "var(--color-mint)" : "rgba(255,255,255,0.55)"} />
        ))}
      </svg>
    );
  }
  if (variant === "line") {
    return (
      <svg viewBox="0 0 160 110" width="100%" height="100%" role="img" aria-label="Illustrative line chart trending upward">
        <line x1="10" y1="95" x2="150" y2="95" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <polyline
          points="14,80 38,74 62,66 86,68 110,44 134,30 150,16"
          fill="none"
          stroke="var(--color-mint)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {[
          [14, 80],
          [62, 66],
          [110, 44],
          [150, 16],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="4" fill="var(--color-mint)" />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 110 110" width="100%" height="100%" role="img" aria-label="Illustrative donut chart">
      <circle cx="55" cy="55" r="42" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="14" />
      <circle
        cx="55"
        cy="55"
        r="42"
        fill="none"
        stroke="var(--color-mint)"
        strokeWidth="14"
        strokeDasharray={`${2 * Math.PI * 42 * 0.72} ${2 * Math.PI * 42}`}
        strokeLinecap="round"
        transform="rotate(-90 55 55)"
      />
    </svg>
  );
}

export function AdBanner({
  eyebrow,
  title,
  body,
  linkTo,
  linkLabel,
  chart,
}: {
  eyebrow: string;
  title: string;
  body: string;
  linkTo: string;
  linkLabel: string;
  chart: ChartVariant;
}) {
  return (
    <div className="ad-banner">
      <div className="ad-banner-copy">
        <p className="eyebrow ad-banner-eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p className="ad-banner-body">{body}</p>
        <Link to={linkTo} className="ad-banner-link">
          {linkLabel} →
        </Link>
      </div>
      <div className="ad-banner-chart">
        <Chart variant={chart} />
      </div>
    </div>
  );
}
