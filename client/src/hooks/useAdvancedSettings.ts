import { useState } from 'react';
import type { StreamParams } from '../api/streamsApi';

export function useAdvancedSettings() {
  const [params, setParams] = useState<StreamParams>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const toggleAdvanced = () => setShowAdvanced((v) => !v);
  return { params, setParams, showAdvanced, toggleAdvanced };
}
