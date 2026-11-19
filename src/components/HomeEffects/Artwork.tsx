import type {CSSProperties, ReactNode} from 'react';
import styles from './styles.module.css';

export function ChapterArtwork({kind}: {kind: 'security' | 'organization' | 'life'}): ReactNode {
  return (
    <div className={styles.artwork} aria-hidden="true">
      {kind === 'security' ? <SecurityArtwork /> : kind === 'organization' ? <OrganizationArtwork /> : <LifeArtwork />}
    </div>
  );
}

function SecurityArtwork(): ReactNode {
  return (
    <svg viewBox="0 0 600 540" fill="none">
      <path d="M0 70H600M0 470H600M70 0V540M530 0V540" stroke="currentColor" opacity=".12" />
      <g className={styles.securityOrbit}>
        {[94, 126, 158].map((radius) => (
          <circle
            key={radius}
            cx="300"
            cy="270"
            r={radius}
            stroke="currentColor"
            opacity=".2"
            strokeDasharray={radius === 158 ? '3 8' : undefined}
          />
        ))}
        <circle cx="300" cy="112" r="6" fill="var(--art-accent)" />
      </g>
      <path
        d="M124 155L300 270 470 133M129 390L300 270 467 389"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity=".25"
      />
      <path
        className={styles.signalTrace}
        d="M124 155L300 270 467 389"
        stroke="var(--art-accent)"
        strokeWidth="2"
        strokeDasharray="28 450"
      />
      <rect x="224" y="194" width="152" height="152" rx="4" fill="var(--art-paper)" stroke="currentColor" />
      <path d="M268 270L291 293 333 246" stroke="var(--art-accent)" strokeWidth="10" />
      {[
        [124, 155, '发现'],
        [470, 133, '验证'],
        [129, 390, '修复'],
        [467, 389, '建设'],
      ].map(([x, y, label]) => (
        <g key={label}>
          <circle cx={Number(x)} cy={Number(y)} r="31" fill="var(--art-paper)" stroke="currentColor" />
          <text x={Number(x)} y={Number(y) + 6} fill="currentColor" stroke="none" textAnchor="middle" fontSize="17">
            {label}
          </text>
        </g>
      ))}
      <text x="28" y="42" fill="currentColor" fontSize="11" letterSpacing="3">
        CURIOSITY → PRACTICE
      </text>
      <text x="28" y="512" fill="currentColor" fontSize="11" letterSpacing="2">
        SECURITY / FIELD NOTES
      </text>
      <path d="M547 501H573M560 488V514" stroke="currentColor" />
    </svg>
  );
}

function OrganizationArtwork(): ReactNode {
  return (
    <svg viewBox="0 0 600 540" fill="none">
      <path d="M0 135H600M0 270H600M0 405H600M150 0V540M300 0V540M450 0V540" stroke="currentColor" opacity=".1" />
      <text x="30" y="43" fill="currentColor" fontSize="11" letterSpacing="3">
        FROM ONE TO MANY
      </text>
      <path d="M120 270H470" stroke="currentColor" strokeDasharray="3 6" opacity=".4" />
      <g className={styles.soloTile}>
        <rect x="70" y="224" width="92" height="92" rx="3" fill="var(--art-accent)" />
        <path d="M99 270H133M116 253V287" stroke="var(--art-paper)" strokeWidth="2" />
      </g>
      <path d="M196 260L207 270 196 280" stroke="currentColor" strokeWidth="2" />
      <g transform="translate(268 154)">
        {Array.from({length: 9}, (_, index) => (
          <g key={index} transform={`translate(${(index % 3) * 76} ${Math.floor(index / 3) * 76})`}>
            <g
              className={styles.teamTile}
              style={
                {
                  '--tile-x': `${((index % 3) - 1) * 20}px`,
                  '--tile-y': `${(Math.floor(index / 3) - 1) * 20}px`,
                  animationDelay: `${index * -0.2}s`,
                } as CSSProperties
              }
            >
              <rect
                width="66"
                height="66"
                rx="3"
                fill={index === 4 ? 'var(--art-accent)' : 'var(--art-paper)'}
                stroke="currentColor"
                strokeOpacity=".65"
              />
              <circle cx="33" cy="33" r="5" fill={index === 4 ? 'var(--art-paper)' : 'currentColor'} />
            </g>
          </g>
        ))}
      </g>
      <text x="116" y="369" fill="currentColor" textAnchor="middle" fontSize="15">
        个人
      </text>
      <text x="378" y="432" fill="currentColor" textAnchor="middle" fontSize="15">
        组织
      </text>
      <text x="30" y="512" fill="currentColor" fontSize="11" letterSpacing="2">
        AI / PEOPLE / PROCESS
      </text>
      <path d="M547 501H573M560 488V514" stroke="currentColor" />
    </svg>
  );
}

function LifeArtwork(): ReactNode {
  return (
    <svg viewBox="0 0 600 540" fill="none">
      <text x="30" y="43" fill="currentColor" fontSize="11" letterSpacing="3">
        MAKE ROOM FOR WHAT MATTERS
      </text>
      <path d="M0 430H600" stroke="currentColor" opacity=".25" />
      <g className={styles.lifeSun}>
        <circle cx="300" cy="236" r="71" fill="var(--art-accent)" />
        {Array.from({length: 24}, (_, index) => (
          <path key={index} d="M300 139V126" stroke="var(--art-accent)" transform={`rotate(${index * 15} 300 236)`} />
        ))}
      </g>
      <path
        d="M118 430V288C118 188 200 107 300 107S482 188 482 288V430M140 430V288C140 200 212 129 300 129S460 200 460 288V430M162 430V288C162 212 224 151 300 151S438 212 438 288V430"
        stroke="currentColor"
        opacity=".24"
      />
      <path
        d="M76 430L230 276 300 346 370 276 524 430"
        fill="var(--art-paper)"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M230 276V430M300 346V430M370 276V430" stroke="currentColor" opacity=".25" />
      <circle cx="230" cy="276" r="5" fill="currentColor" />
      <circle cx="370" cy="276" r="5" fill="currentColor" />
      <text x="139" y="467" fill="currentColor" fontSize="15">
        时间
      </text>
      <text x="284" y="467" fill="currentColor" fontSize="15">
        精力
      </text>
      <text x="427" y="467" fill="currentColor" fontSize="15">
        选择
      </text>
      <text x="30" y="512" fill="currentColor" fontSize="11" letterSpacing="2">
        LIFE / A WORK IN PROGRESS
      </text>
      <path d="M547 501H573M560 488V514" stroke="currentColor" />
    </svg>
  );
}
