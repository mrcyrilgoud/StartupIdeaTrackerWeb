import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';

const Home = lazy(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const Detail = lazy(() => import('./pages/Detail').then((module) => ({ default: module.Detail })));
const Generator = lazy(() => import('./pages/Generator').then((module) => ({ default: module.Generator })));
const SettingsPage = lazy(() => import('./pages/Settings').then((module) => ({ default: module.SettingsPage })));
const IdeaSpark = lazy(() => import('./pages/IdeaSpark').then((module) => ({ default: module.IdeaSpark })));

function App() {
    return (
        <BrowserRouter>
            <Suspense fallback={<div className="p-5">Loading...</div>}>
                <Routes>
                    <Route path="/" element={<Layout />}>
                        <Route index element={<Home />} />
                        <Route path="generate" element={<Generator />} />
                        <Route path="spark" element={<IdeaSpark />} />
                        <Route path="idea/:id" element={<Detail />} />
                        <Route path="settings" element={<SettingsPage />} />
                    </Route>
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
