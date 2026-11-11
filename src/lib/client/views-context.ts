import { getContext, setContext } from 'svelte';
import type { ViewStore } from './viewStore.svelte';

const KEY = Symbol('views');
export const setViews = (v: ViewStore) => setContext(KEY, v);
export const getViews = () => getContext<ViewStore>(KEY);
