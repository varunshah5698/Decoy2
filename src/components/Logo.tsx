import { cx } from '../lib/format'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={cx('brand-mark', className)} viewBox="0 0 40 44" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="shieldOuter" x1="20" y1="2" x2="20" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3ED2C1" stopOpacity="0.95" />
          <stop offset="1" stopColor="#3ED2C1" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="shieldInner" x1="20" y1="9" x2="20" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F4C384" />
          <stop offset="1" stopColor="#E3A455" />
        </linearGradient>
      </defs>
      <path
        d="M20 3.2 36.2 9.7v13.9c0 8.7-6.2 15.7-16.2 18.9C10 39.3 3.8 32.3 3.8 23.6V9.7L20 3.2Z"
        stroke="url(#shieldOuter)"
        strokeWidth="1.3"
      />
      <path
        d="M20 10.6 30.2 14.7v8.4c0 5.5-3.9 10-10.2 12.1-6.3-2.1-10.2-6.6-10.2-12.1v-8.4L20 10.6Z"
        stroke="url(#shieldInner)"
        strokeWidth="1.1"
      />
      <path d="M20 17v9" stroke="#E3A455" strokeWidth="1.1" strokeLinecap="round" opacity=".7" />
      <circle cx="20" cy="15" r="2" fill="#F4C384" />
      <circle cx="20" cy="28" r="1.2" fill="#3ED2C1" />
    </svg>
  )
}

export function Logo({ sub = 'Threat early warning', className }: { sub?: string; className?: string }) {
  return (
    <span className={cx('brand', className)}>
      <LogoMark />
      <span>
        Aegis Sentinel
        <small>{sub}</small>
      </span>
    </span>
  )
}
