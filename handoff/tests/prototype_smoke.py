"""Reference-only UI smoke test. Requires Python Playwright + a Chromium binary.
This tests the supplied offline HTML, NOT real playback, Safari, or backend APIs.
Example: CHROMIUM_BIN=/usr/bin/chromium python tests/prototype_smoke.py
"""
from pathlib import Path
import json, os, shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'prototype/index.html').read_text()
OUT=ROOT/'design/screenshots'
OUT.mkdir(parents=True, exist_ok=True)
checks=[]
def check(condition:bool,label:str)->None:
    if not condition: raise AssertionError(label)
    checks.append(label)

def snap(page,name):
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT/name), full_page=False)

with sync_playwright() as p:
    binary=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('google-chrome')
    opts={'headless':True}
    if binary:opts['executable_path']=binary
    if hasattr(os,'geteuid') and os.geteuid()==0:opts['args']=['--no-sandbox']
    browser=p.chromium.launch(**opts)
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    errors=[]; requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url))
    # Inline-load keeps the test independent of file:// navigation policy.
    page.set_content(HTML,wait_until='load')
    check(page.get_by_role('button',name='為我開台').is_disabled(),'Empty Seed disables generation')
    snap(page,'01-home.png')
    page.get_by_role('button',name='收聽',exact=True).click()
    check(page.get_by_role('button',name='去開台').is_visible(),'Listen has an actionable empty state')
    page.get_by_role('button',name='去開台').click()
    page.get_by_role('button',name='深夜，還不想睡',exact=True).click()
    check(page.locator('#seed').input_value()=='深夜，還不想睡','Example fills without submitting')
    snap(page,'01b-home-filled.png')
    page.get_by_role('button',name='為我開台').click()
    page.get_by_role('button',name='取消，保留我的輸入').click()
    page.wait_for_timeout(2500)
    check(page.locator('#seed').input_value()=='深夜，還不想睡','Cancelled generation preserves draft; late timer cannot publish')
    page.get_by_role('button',name='為我開台').click()
    page.get_by_role('button',name='開始收聽 · 示意',exact=True).wait_for()
    check(page.get_by_text('尚未開始播放',exact=True).is_visible(),'Ready is not auto-playing')
    snap(page,'02-ready.png')
    page.get_by_role('button',name='開始收聽 · 示意',exact=True).click()
    before=page.locator('.song-heading h1').inner_text()
    page.get_by_role('button',name='跳過介紹').click()
    check(page.locator('.song-heading h1').inner_text()==before,'Skip intro keeps current track')
    page.get_by_role('button',name='暫停示意播放',exact=True).click()
    pos=page.locator('#elapsed').inner_text()
    page.wait_for_timeout(1200)
    check(page.locator('#elapsed').inner_text()==pos,'Paused demo progress remains still')
    snap(page,'03-listen.png')
    page.get_by_role('button',name='為什麼是這首').click()
    check(page.locator('#sheet').evaluate('(el)=>el.open'),'Bridge opens a named native dialog')
    snap(page,'04-bridge.png')
    page.keyboard.press('Escape')
    check(not page.locator('#sheet').evaluate('(el)=>el.open'),'Escape closes dialog')
    page.wait_for_timeout(100)
    check(page.evaluate("document.activeElement?.dataset.action==='bridge'"),'Dialog returns focus to its trigger')
    page.get_by_role('button',name='查看節目單，目前第 1 首，共 5 首').click()
    snap(page,'05-queue.png')
    page.get_by_role('button',name='移除 雨後的底片',exact=True).click()
    check(page.locator('.queue-row').count()==4,'Remove affects future queue only')
    page.get_by_role('button',name='復原',exact=True).click()
    check(page.locator('.queue-row').count()==5,'Undo remains operable inside the modal')
    page.get_by_role('button',name='關閉面板').click()
    page.wait_for_timeout(100)
    page.get_by_role('button',name='微調',exact=True).click()
    page.get_by_role('button',name='更放鬆',exact=True).click()
    snap(page,'06-tune.png')
    page.get_by_role('button',name='套用到接下來').click()
    check(page.locator('.song-heading h1').inner_text()==before,'Tune preserves current track')
    check(page.locator('.next-copy strong').inner_text()=='柔焦公路','Tune mock swaps only upcoming items')
    page.get_by_role('button',name='設定',exact=True).click()
    check(page.locator('.mini').is_visible(),'Mini-player follows navigation without replacing session')
    snap(page,'07-settings.png')
    page.get_by_role('button',name='查看「連線中斷」狀態').click()
    check(page.get_by_role('button',name='重新連線 · 示意').is_visible(),'Offline state offers explicit recovery')
    snap(page,'08-offline.png')
    page.get_by_role('button',name='重新連線 · 示意').click()
    page.get_by_role('button',name='暫停示意播放',exact=True).click()
    for width,height in [(320,568),(360,800),(390,844),(430,932),(1440,1000)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(250)
        check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Listen has no horizontal overflow at {width}px')
        snap(page,f'09-listen-{width}.png')
    # Large-text check is not a full WCAG/assistive-technology audit.
    page.set_viewport_size({'width':390,'height':844})
    page.add_style_tag(content='body{font-size:32px}button{overflow-wrap:anywhere}')
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Body text-size smoke check has no horizontal overflow')
    check(not requests,'Prototype makes no network requests')
    check(not errors,f'No JavaScript runtime errors: {errors}')
    browser.close()

result={'prototypeOnly':True,'browser':'Chromium via Playwright','method':'inline HTML load; no file:// navigation claim','checksPassed':len(checks),'checks':checks,'notTested':['Real iPhone Safari / standalone PWA','Android device audio','Spotify OAuth, API, SDK, policy approval','LLM and TTS integration','VoiceOver / TalkBack','True 200% browser zoom and full accessibility audit']}
(ROOT/'tests/prototype-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
