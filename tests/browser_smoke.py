"""Optional real Chromium checks: python3 tests/browser_smoke.py (requires Playwright)."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def run():
    subprocess.run(["node", "scripts/build.mjs"], cwd=ROOT, check=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="yuan-browser-") as directory:
        env = {**os.environ, "YUAN_DEV_PORT": str(port), "YUAN_DEV_DATA_DIR": directory,
               "AI_API_KEY": "", "AI_BASE_URL": "", "AI_MODEL": ""}
        server = subprocess.Popen(["node", "scripts/dev.mjs"], cwd=ROOT, env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        base = f"http://127.0.0.1:{port}"
        try:
            # Loopback checks deliberately use no outbound network proxy.
            http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(50):
                if server.poll() is not None:
                    raise RuntimeError(server.stderr.read().decode())
                try:
                    with http.open(base + "/api/health", timeout=1) as response:
                        assert json.load(response)["ready"]
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError("Development server did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), headless=True,
                                                     args=["--no-sandbox"])
                page = browser.new_page(viewport={"width": 1440, "height": 1000})
                page.clock.install()
                requests = []
                page.on('request', lambda request: requests.append(request.url))
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base)
                expect(page.locator("#pageTitle")).to_have_text("工作总览")
                expect(page.locator("[data-advice-panel]")).to_be_visible()
                page.locator('[data-action="generate"]').first.click()
                page.locator('#modal button[type=submit]').click()
                expect(page.locator('#modal')).not_to_be_visible()
                expect(page.locator('.day-grid')).to_be_visible()
                page.wait_for_function("() => !workspace._sync?.pending")
                workspace = page.request.get(base + "/api/workspace").json()
                assert len(workspace["workspace"]["projects"][0]["tasks"]) == 45
                print("PASS generated plan, saved locally and synchronized 45 tasks", flush=True)

                # Rules appear before committing a major decision; no model is required.
                page.locator('[data-action="publishWeek"]').click()
                expect(page.locator('#modal [data-advice-panel]')).to_be_visible()
                expect(page.locator('#modal [data-rule-hints]')).to_contain_text("图纸尚未复核")
                page.locator('#modal [data-close]').first.click()
                page.locator('[data-view="settings"]').click()
                page.locator('#projectForm [name=area]').fill('100')
                page.locator('#projectForm [name=floor]').fill('1000')
                expect(page.locator('[data-project-hints]')).to_contain_text('1.5 倍')
                # Dirty forms survive the polling guard and saving controls reject duplicate submissions.
                assert page.locator('#projectForm').get_attribute('data-dirty') == 'true'
                before_poll = len(requests)
                page.clock.fast_forward(31000)
                expect(page.locator('#projectForm [name=floor]')).to_have_value('1000')
                assert not any(url.endswith('/api/workspace') for url in requests[before_poll:])
                page.locator('#projectForm [name=floor]').fill('90')
                before_activity = len(workspace['workspace']['projects'][0]['activity'])
                page.locator('#projectForm').evaluate('(form) => {form.requestSubmit(); form.requestSubmit();}')
                page.wait_for_function("() => !workspace._sync?.pending")
                updated = page.request.get(base + '/api/workspace').json()
                assert len(updated['workspace']['projects'][0]['activity']) == before_activity + 1
                print("PASS live invalid-data suggestions and decision review hints", flush=True)

                for width, height in [(360, 780), (768, 1024), (1440, 1000)]:
                    page.set_viewport_size({"width": width, "height": height})
                    for view in ['dashboard', 'plan', 'materials', 'workers', 'client', 'drawing', 'designer', 'settings']:
                        page.locator(f'[data-view="{view}"]').click()
                        overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                        assert not overflow, f"Page overflow at {width}px in {view}"
                    page.locator('[data-view="materials"]').click()
                    page.locator('[data-action="newRequest"]').click()
                    page.locator('[data-action="addMaterialLine"]').click()
                    assert not page.locator('#modal').evaluate('(e) => e.scrollWidth > e.clientWidth + 1'), width
                    if width == 360:
                        page.screenshot(path='/tmp/yuan-v34-mobile.png', full_page=True)
                    page.locator('#modal [data-close]').first.click()
                    print(f"PASS all 8 views and material dialog fit {width}px", flush=True)

                page.locator('[data-view="settings"]').click()
                page.context.set_offline(True)
                page.locator('#projectForm [name=area]').fill('101')
                page.locator('#projectForm button.primary').click()
                page.wait_for_function('() => !unsaved && workspace._sync?.pending')
                page.clock.fast_forward(1000)
                expect(page.locator('#saveStatus')).to_contain_text('网络恢复后')
                page.context.set_offline(False)
                page.wait_for_function('() => !workspace._sync?.pending')
                assert page.request.get(base + '/api/workspace').json()['workspace']['projects'][0]['project']['area'] == 101
                print('PASS dirty-form polling protection, duplicate-submit protection and offline recovery', flush=True)

                page.locator('[data-view="client"]').click()
                expect(page.locator('.assistant-panel')).to_contain_text('100% 上报后仍需负责人验收')
                page.locator('[data-action="askAI"]').click()
                expect(page.locator('[data-ai-result]')).to_contain_text('尚未配置')

                # Simulate a compatible provider response at the API boundary, not a live paid request.
                current = page.request.get(base + '/api/workspace').json()
                project_id = current['workspace']['projects'][0]['id']
                page.route('**/api/ai/advice', lambda route: route.fulfill(
                    status=200, content_type='application/json', body=json.dumps({
                        'source': 'ai', 'revision': current['revision'], 'projectId': project_id,
                        'explanation': '<img src=x onerror=alert(1)> 请向负责人确认验收安排。', 'checks': []})))
                # A fresh question bypasses the cached unconfigured response.
                page.locator('.advice-question summary').click()
                page.locator('[data-ai-question]').fill('请解释验收流程')
                page.locator('[data-action="askAI"]').click()
                expect(page.locator('[data-ai-result]')).to_contain_text('请向负责人确认验收安排')
                assert page.locator('[data-ai-result] img').count() == 0
                page.screenshot(path='/tmp/yuan-v34-desktop.png', full_page=True)
                page.reload()
                expect(page.locator('#pageTitle')).to_have_text('工作总览')
                assert len(page.request.get(base + '/api/workspace').json()['workspace']['projects'][0]['tasks']) == 45
                assert not errors, errors
                print('PASS customer explanations, AI fallback, safe AI rendering and reload persistence', flush=True)
                browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == '__main__':
    run()
