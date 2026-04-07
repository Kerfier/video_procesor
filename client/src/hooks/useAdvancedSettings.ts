import { useState } from 'react';
import type { StreamParams } from '../api/streamsApi';

export function useAdvancedSettings() {
  const [params, setParams] = useState<StreamParams>({
    detectionInterval: 5,
    blurStrength: 51,
    conf: 0.25,
    lookbackFrames: 30,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const toggleAdvanced = () => setShowAdvanced((v) => !v);
  return { params, setParams, showAdvanced, toggleAdvanced };
}
