import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Detail } from './pages/Detail';
import { Generator } from './pages/Generator';
import { SettingsPage } from './pages/Settings';
import { IdeaSpark } from './pages/IdeaSpark';
import { StartupRace } from './pages/StartupRace';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Home />} />
                    <Route path="generate" element={<Generator />} />
                    <Route path="spark" element={<IdeaSpark />} />
                    <Route path="race" element={<StartupRace />} />
                    <Route path="idea/:id" element={<Detail />} />
                    <Route path="settings" element={<SettingsPage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
