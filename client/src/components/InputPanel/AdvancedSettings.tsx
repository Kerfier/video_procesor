import type { StreamParams } from '../../api/streamsApi';
import styles from './AdvancedSettings.module.css';

interface AdvancedSettingsProps {
  value: StreamParams;
  onChange: (params: StreamParams) => void;
  disabled?: boolean;
}

interface FieldDef {
  key: Exclude<keyof StreamParams, 'trackerAlgorithm'>;
  label: string;
  hint: string;
  tooltip: string;
  min: number;
  max?: number;
  step: number;
}

const FIELDS: FieldDef[] = [
  {
    key: 'detectionInterval',
    label: 'Detection interval',
    hint: '5 – 20 frames',
    tooltip:
      'How many frames to skip between full YOLO detections. Lower = more accurate but slower; higher = faster with a risk of missing brief appearances.',
    min: 5,
    max: 20,
    step: 1,
  },
  {
    key: 'blurStrength',
    label: 'Blur strength',
    hint: 'odd number, e.g. 51',
    tooltip:
      'Gaussian blur kernel size applied to faces and plates. Must be an odd number. Higher values produce stronger, wider blur.',
    min: 1,
    step: 2,
  },
  {
    key: 'conf',
    label: 'Confidence',
    hint: '0.1 – 1.0',
    tooltip:
      'Minimum YOLO detection confidence. Lower catches more objects but increases false positives; higher is more selective.',
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    key: 'lookbackFrames',
    label: 'Lookback frames',
    hint: 'backward tracking depth',
    tooltip:
      'Frames held in memory for backward tracking. When a new face or plate is detected, blur is applied retroactively this many frames back.',
    min: 1,
    step: 1,
  },
];

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <span className={styles.infoIcon} aria-label={tooltip}>
      ?<span className={styles.tooltipText}>{tooltip}</span>
    </span>
  );
}

export function AdvancedSettings({ value, onChange, disabled }: AdvancedSettingsProps) {
  const handleChange = (key: Exclude<keyof StreamParams, 'trackerAlgorithm'>, raw: string) => {
    const num = raw === '' ? undefined : Number(raw);
    onChange({ ...value, [key]: num });
  };

  return (
    <div className={styles.grid}>
      {FIELDS.map(({ key, label, hint, tooltip, min, max, step }) => (
        <label key={key} className={styles.field}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{label}</span>
            <InfoIcon tooltip={tooltip} />
          </div>
          <span className={styles.hint}>{hint}</span>
          <input
            className={styles.input}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value[key] ?? ''}
            disabled={disabled}
            onChange={(e) => handleChange(key, e.target.value)}
          />
        </label>
      ))}
      <label className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>Tracker</span>
          <InfoIcon tooltip="KCF is faster and suitable for most cases. CSRT handles scale changes and partial occlusion better but is slower." />
        </div>
        <span className={styles.hint}>tracking algorithm</span>
        <select
          className={styles.select}
          value={value.trackerAlgorithm ?? 'kcf'}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, trackerAlgorithm: e.target.value as 'kcf' | 'csrt' })
          }
        >
          <option value="kcf">KCF (faster)</option>
          <option value="csrt">CSRT (more accurate)</option>
        </select>
      </label>
    </div>
  );
}
