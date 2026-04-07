import type { StreamStatusResponse } from '../api/streamsApi';

export interface StreamState {
  streamId: string | null;
  statusResponse: StreamStatusResponse | null;
  isLoading: boolean;
  startError: string | null;
}

export type StreamAction =
  | { type: 'START' }
  | { type: 'START_OK'; streamId: string }
  | { type: 'START_ERR'; message: string }
  | { type: 'STATUS'; response: StreamStatusResponse }
  | { type: 'RESET' };

export const initialState: StreamState = {
  streamId: null,
  statusResponse: null,
  isLoading: false,
  startError: null,
};

export function reducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'START':
      return { ...state, isLoading: true, startError: null };
    case 'START_OK':
      return { ...state, isLoading: false, streamId: action.streamId, statusResponse: null };
    case 'START_ERR':
      return { ...state, isLoading: false, startError: action.message };
    case 'STATUS':
      return { ...state, statusResponse: action.response };
    case 'RESET':
      return initialState;
  }
}
