import type { StreamParams } from '../../api/streamsApi';
import styles from './AdvancedSettings.module.css';

interface AdvancedSettingsProps {
  value: StreamParams;
  onChange: (params: StreamParams) => void;
}

interface FieldDef {
  key: keyof StreamParams;
  label: string;
  hint: string;
  min: number;
  step: number;
}

const FIELDS: FieldDef[] = [
  {
    key: 'detectionInterval',
    label: 'Detection interval',
    hint: 'frames between YOLO runs',
    min: 1,
    step: 1,
  },
  { key: 'blurStrength', label: 'Blur strength', hint: 'odd number, e.g. 51', min: 1, step: 2 },
  { key: 'conf', label: 'Confidence', hint: '0.0 – 1.0', min: 0.01, step: 0.05 },
  {
    key: 'lookbackFrames',
    label: 'Lookback frames',
    hint: 'backward tracking depth',
    min: 1,
    step: 1,
  },
];

export function AdvancedSettings({ value, onChange }: AdvancedSettingsProps) {
  const handleChange = (key: keyof StreamParams, raw: string) => {
    const num = raw === '' ? undefined : Number(raw);
    onChange({ ...value, [key]: num });
  };

  return (
    <div className={styles.grid}>
      {FIELDS.map(({ key, label, hint, min, step }) => (
        <label key={key} className={styles.field}>
          <span className={styles.label}>{label}</span>
          <span className={styles.hint}>{hint}</span>
          <input
            className={styles.input}
            type="number"
            min={min}
            step={step}
            value={value[key] ?? ''}
            onChange={(e) => handleChange(key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
