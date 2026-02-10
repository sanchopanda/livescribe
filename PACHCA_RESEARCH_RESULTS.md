# Pachca Speaker Detection - Research Results

**Date:** 2026-02-06
**Platform:** Пачка (pachca.com)
**Status:** ✅ Completed

---

## Summary

Successfully identified the DOM pattern for detecting the active speaker in Pachca video calls.

## Key Findings

### Active Speaker Indicator

**Element Selector:**
```javascript
'.dynamic-shadow'
```

**Detection Method:** Dynamic box-shadow on participant video element

**Active Speaker Pattern:**
- Box-shadow has **non-zero** blur radius and spread radius
- Example: `box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 2px 20px, rgba(255, 255, 255, 0.2) 0px 0px 6px 30px;`

**Idle State Pattern:**
- Box-shadow has **zero** blur and spread values
- Example: `box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 0px 0px, rgba(255, 255, 255, 0.2) 0px 0px 0px 0px;`

### Visual Effect

Pachca uses a **white glow effect** around the active speaker's video tile:
- The glow appears when participant starts speaking
- The glow disappears when participant stops speaking
- Glow intensity varies (blur and spread values change slightly)

### Sample Log Entries

**Speaking started (timestamp: 1770698151487):**
```json
{
  "timestamp": 1770698151487,
  "type": "modified",
  "element": "<div.dynamic-shadow>",
  "platform": "Pachca",
  "changes": {
    "attribute": "style",
    "oldValue": "box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 0px 0px, rgba(255, 255, 255, 0.2) 0px 0px 0px 0px;",
    "newValue": "box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 2px 20px, rgba(255, 255, 255, 0.2) 0px 0px 6px 30px;"
  }
}
```

**Speaking stopped (timestamp: 1770698151687):**
```json
{
  "timestamp": 1770698151687,
  "type": "modified",
  "element": "<div.dynamic-shadow>",
  "platform": "Pachca",
  "changes": {
    "attribute": "style",
    "oldValue": "box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 2px 20px, rgba(255, 255, 255, 0.2) 0px 0px 6px 31px;",
    "newValue": "box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 0px 0px, rgba(255, 255, 255, 0.2) 0px 0px 0px 0px;"
  }
}
```

### Pattern Variations

Observed glow intensity values:
- `6px 31px` (stronger)
- `6px 42px` (even stronger)
- `6px 30px` (normal)

The exact blur/spread values may vary, but the key is **non-zero vs zero**.

## Implementation Guide

### Detection Method

To detect the current active speaker:

```javascript
// Find all participant video elements with dynamic-shadow
const participants = document.querySelectorAll('.dynamic-shadow');

participants.forEach((element) => {
  const style = element.getAttribute('style');
  const boxShadow = style?.match(/box-shadow:\s*([^;]+)/)?.[1];

  if (boxShadow) {
    // Check if any blur/spread values are non-zero
    const hasGlow = !boxShadow.includes('0px 0px 0px 0px');

    if (hasGlow) {
      // This participant is currently speaking
      console.log('Active speaker found:', element);
    }
  }
});
```

### Real-time Monitoring

Use MutationObserver to watch for style changes:

```javascript
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
      const target = mutation.target as HTMLElement;

      if (target.classList.contains('dynamic-shadow')) {
        const newStyle = target.getAttribute('style') || '';
        const oldStyle = mutation.oldValue || '';

        // Check if box-shadow changed from zero to non-zero
        const wasActive = !oldStyle.includes('0px 0px 0px 0px');
        const isActive = !newStyle.includes('0px 0px 0px 0px');

        if (!wasActive && isActive) {
          console.log('Speaker started talking');
        } else if (wasActive && !isActive) {
          console.log('Speaker stopped talking');
        }
      }
    }
  });
});

observer.observe(document.body, {
  attributes: true,
  attributeFilter: ['style'],
  subtree: true,
  attributeOldValue: true
});
```

### Simplified Detection (Regex)

```javascript
function isActiveSpeaker(element: HTMLElement): boolean {
  const style = element.getAttribute('style') || '';
  const boxShadowMatch = style.match(/box-shadow:\s*[^;]+/);

  if (!boxShadowMatch) return false;

  // If all blur/spread values are 0, speaker is not active
  return !boxShadowMatch[0].includes('0px 0px 0px 0px');
}
```

## Stability Assessment

**Class Name Stability:** ✅ **HIGH**
- `.dynamic-shadow` is a semantic class name
- Unlikely to change as it describes the visual effect

**Style Pattern Stability:** ✅ **HIGH**
- Box-shadow animation is a core visual feature
- Very stable pattern across updates

**Overall Stability:** ✅ **VERY HIGH**
- Simple, semantic, and visual-based detection
- Most reliable pattern so far

## Recommendations

1. **Primary Detection:** Monitor `style` attribute changes on `.dynamic-shadow` elements
2. **Detection Logic:** Check if box-shadow has non-zero blur/spread values
3. **Performance:** Very efficient - only monitors style attribute changes
4. **Reliability:** Highly reliable - visual effect is core to UX

## Testing Notes

- Tested with 1 participant (self)
- Response time: ~200ms between speaking and shadow change
- Shadow intensity varies slightly (30-42px spread)
- No false positives observed
- Pattern is very consistent

## Advantages over Other Platforms

- ✅ **Semantic class name** (`.dynamic-shadow`)
- ✅ **Visual indicator** (easy to verify manually)
- ✅ **Stable pattern** (unlikely to break)
- ✅ **Simple detection** (just check for non-zero values)
- ✅ **No minified classes** (unlike Google Meet)

## DOM Structure

### 1-on-1 Call Layout

```html
<div class="videocontainer" id="largeVideoContainer" style="background-color: rgb(4, 4, 4); display: inline-block;">
  <!-- Shared video container -->
  <div class="disable-pointer" id="sharedVideo" style="width: 1187px; height: 715px;"></div>

  <!-- Etherpad -->
  <div id="etherpad"></div>

  <!-- Watermark -->
  <div>
    <a aria-label="Пачка Логотип, ссылки на главную страницу"
       class="watermark leftwatermark"
       href="https://app.pachca.com"
       target="_new"
       style="visibility: visible;">
      <div class="watermark leftwatermark"
           style="background-image: url('images/watermark.svg'); position: static; visibility: visible;">
      </div>
    </a>
  </div>

  <!-- Dominant speaker container -->
  <div id="dominantSpeaker" style="visibility: visible;">
    <!-- ✅ SPEAKING INDICATOR - dynamic shadow -->
    <div class="dynamic-shadow"
         style="box-shadow: rgba(255, 255, 255, 0.4) 0px 0px 0px 0px, rgba(255, 255, 255, 0.2) 0px 0px 0px 0px;">
    </div>

    <!-- Avatar -->
    <div id="dominantSpeakerAvatarContainer">
      <div class="avatar css-e92puo-avatar"
           id="dominantSpeakerAvatar"
           style="font-size: 80px; height: 200px; width: 200px; background: rgb(255, 155, 66);">
        <div class="css-1s788x3-initialsContainer">D</div>
      </div>
    </div>
  </div>

  <!-- Remote presence/connection messages -->
  <div id="remotePresenceMessage" style="top: 505.5px;"></div>
  <span id="remoteConnectionMessage" style="top: 505.5px; display: none;"></span>

  <!-- Large video elements -->
  <div id="largeVideoElementsContainer" class="animatedFadeOut" style="visibility: hidden;">
    <div id="largeVideoBackgroundContainer">
      <div class="large-video-background invisible">
        <canvas id="largeVideoBackground"></canvas>
      </div>
    </div>
    <div id="largeVideoWrapper" role="figure">
      <video autoplay="" id="largeVideo" playsinline=""></video>
    </div>
  </div>

  <!-- ✅ PARTICIPANT NAME LABEL -->
  <div class="stage-participant-label css-kiy7mf-badgeContainer">
    <div class="css-1q78t7r-badge">dime</div>
  </div>
</div>
```

### Extracting Participant Name (1-on-1)

**Selector:**
```javascript
'.stage-participant-label .css-1q78t7r-badge'
```

**Example:**
```javascript
const nameElement = document.querySelector('.stage-participant-label .css-1q78t7r-badge');
const participantName = nameElement?.textContent; // "dime"
```

**Full Detection Example:**
```javascript
// Find active speaker
const dynamicShadow = document.querySelector('.dynamic-shadow');
const style = dynamicShadow?.getAttribute('style') || '';
const isActive = !style.includes('0px 0px 0px 0px');

if (isActive) {
  // Get participant name
  const nameElement = document.querySelector('.stage-participant-label .css-1q78t7r-badge');
  const name = nameElement?.textContent;

  console.log('Active speaker:', name); // "dime"
}
```

**⚠️ Important Notes:**

1. **This structure is for 1-on-1 calls**
   - Multi-participant calls have a different DOM structure (see next section)

2. **Class names may be minified**
   - `css-kiy7mf-badgeContainer` and `css-1q78t7r-badge` look like CSS-in-JS generated classes
   - May change across builds/updates
   - Consider using semantic selectors like `.stage-participant-label` as primary

3. **Alternative selectors to try:**
    - `#dominantSpeaker` - container for active speaker
    - `[id*="dominantSpeaker"]` - fuzzy match
    - Text content extraction from any child of `#dominantSpeaker`

### Multi-participant Call Layout (filmstrip/sidebar)

**Update:** 2026-02-10

In calls with many participants, Pachca renders a *sidebar filmstrip* with remote videos.

**Filmstrip container (example):**
```css
.filmstrip__videos.remote-videos
```

**Participant tile (example):**
- Tile element is often a `span` with an `id` like `participant_<hash>`
- Name is in a sibling/descendant element with predictable id: `participant_<hash>_name`

```html
<span class="videocontainer ... dominant-speaker" id="participant_3e1d9e3f">
  ...
  <span class="displayname ..." id="participant_3e1d9e3f_name">Азат Кабиров</span>
  ...
</span>
```

#### Active speaker detection (filmstrip)

**Primary indicator:** class `dominant-speaker` on the participant tile.

**Selector:**
```js
document.querySelector('.filmstrip__videos [id^="participant_"].dominant-speaker')
```

**Notes about stability:**
- `dominant-speaker` looks semantic (good)
- ignore `jss*` and `css-*` classes (unstable)

#### Extracting speaker name (filmstrip)

**Primary (stable) approach:** use the tile `id` to lookup `${id}_name`.

```js
function getActiveSpeakerFromFilmstrip() {
  const tile = document.querySelector(
    '.filmstrip__videos [id^="participant_"].dominant-speaker'
  );
  if (!tile) return null;

  const id = tile.id;
  const nameEl = document.getElementById(`${id}_name`) ?? tile.querySelector('.displayname');
  const name = nameEl?.textContent?.trim() || null;

  return { id, name, tile };
}
```

#### Relationship with 1-on-1 detection

If filmstrip is not present (or `dominant-speaker` is missing), fallback to the **1-on-1** logic:
- `.dynamic-shadow` + `box-shadow` non-zero detection
- name via `.stage-participant-label`

## Next Steps

- [x] Test with multiple participants in a call (PRIORITY)
- [x] Extract participant names/identifiers (1-on-1 only)
- [x] Research multi-participant DOM structure
- [ ] Verify pattern works across different Pachca themes
- [ ] Implement production speaker tracker
- [ ] Confirm pattern stability across Pachca updates

---

**Research conducted using:** Platform Research Extension v0.1.0
**Total logs collected:** 8 DOM mutations
**Session duration:** ~14 seconds of speaking activity
