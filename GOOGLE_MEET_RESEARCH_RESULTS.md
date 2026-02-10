# Google Meet Speaker Detection - Research Results

**Date:** 2026-02-06
**Platform:** Google Meet (meet.google.com)
**Status:** ✅ Completed

---

## Summary

Successfully identified the DOM pattern for detecting the active speaker in Google Meet calls.

## Key Findings

### Active Speaker Indicator

**Element Selector:**
```javascript
'[jscontroller="YQvg8b"]'
```

**Active Speaker Class:**
```javascript
'wEsLMd'
```

**Secondary Indicator Class:**
```javascript
'sxlEM'
```

**Idle State Class:**
```javascript
'gjg47c'
```

### Detection Pattern

When a participant starts speaking:
- The element with `jscontroller="YQvg8b"` **gains** the class `wEsLMd`
- Often accompanied by the class `sxlEM`
- The class `gjg47c` is **removed**

When a participant stops speaking:
- The class `wEsLMd` is **removed**
- The class `sxlEM` may be removed
- The class `gjg47c` is **added back**

### DOM Structure

```html
<!-- Participant container (idle state) -->
<div class="qRU4mf uSECwd JTEhGf eQJ1qd">
  <div class="sCE0Tb"></div>

  <!-- Speaking indicator element -->
  <div jscontroller="YQvg8b"
       class="DYfzY cYKTje gjg47c"
       jsname="QgSmzd"
       jsaction="rcuQ6b:wfi2bd;sA65sc:wfi2bd;bbo0ld:wfi2bd">
  </div>

  <!-- Avatar container -->
  <div class="qg7mD r6DyN xm86Be JBY0Kc eXUaib KXY1yb">
    <img alt=""
         class="SOQwsf"
         src="https://lh3.googleusercontent.com/a/...">
  </div>
</div>
```

```html
<!-- Same participant (speaking state) -->
<div class="qRU4mf uSECwd JTEhGf eQJ1qd">
  <div class="sCE0Tb"></div>

  <!-- Speaking indicator element - ACTIVE -->
  <div jscontroller="YQvg8b"
       class="DYfzY cYKTje wEsLMd sxlEM"
       jsname="QgSmzd"
       jsaction="rcuQ6b:wfi2bd;sA65sc:wfi2bd;bbo0ld:wfi2bd">
  </div>

  <!-- Avatar container - may also gain BlxGDf class -->
  <div class="qg7mD r6DyN xm86Be JBY0Kc eXUaib BlxGDf KXY1yb">
    <img alt=""
         class="SOQwsf"
         src="https://lh3.googleusercontent.com/a/...">
  </div>
</div>
```

### Sample Log Entries

**Speaking started (timestamp: 1770353898896):**
```json
{
  "timestamp": 1770353898896,
  "type": "modified",
  "element": "<div.DYfzY.cYKTje.wEsLMd>",
  "platform": "Google Meet",
  "changes": {
    "attribute": "class",
    "oldValue": "DYfzY cYKTje gjg47c",
    "newValue": "DYfzY cYKTje wEsLMd sxlEM"
  }
}
```

**Speaking stopped (timestamp: 1770353902698):**
```json
{
  "timestamp": 1770353902698,
  "type": "modified",
  "element": "<div.DYfzY.cYKTje.gjg47c>",
  "platform": "Google Meet",
  "changes": {
    "attribute": "class",
    "oldValue": "DYfzY cYKTje wEsLMd sxlEM",
    "newValue": "DYfzY cYKTje gjg47c"
  }
}
```

### Additional Indicators

The avatar container (containing the participant's image) also changes:
- **Speaking:** Gains the class `BlxGDf`
- **Not speaking:** Class `BlxGDf` is removed

## Implementation Guide

### Detection Method

To detect the current active speaker:

```javascript
// Find the active speaker element
const activeSpeaker = document.querySelector('[jscontroller="YQvg8b"].wEsLMd');

if (activeSpeaker) {
  // This participant is currently speaking
  // Navigate to find participant info (name, etc.)
  const participantContainer = activeSpeaker.closest('.qRU4mf');
  const avatarImg = participantContainer?.querySelector('img[src*="googleusercontent"]');
  // Extract participant name from nearby elements or aria-labels
}
```

### Real-time Monitoring

Use MutationObserver to watch for class changes:

```javascript
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const target = mutation.target as HTMLElement;

      if (target.matches('[jscontroller="YQvg8b"]')) {
        const classList = target.classList;

        if (classList.contains('wEsLMd')) {
          // Speaker started talking
          console.log('Speaker active');
        } else if (classList.contains('gjg47c')) {
          // Speaker stopped talking
          console.log('Speaker inactive');
        }
      }
    }
  });
});

observer.observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
  subtree: true,
  attributeOldValue: true
});
```

## Stability Assessment

**Class Name Stability:** ⚠️ **LOW**
- Classes like `wEsLMd`, `gjg47c`, `BlxGDf` are minified/obfuscated
- These class names may change with Google Meet updates
- Recommend periodic verification

**Selector Stability:** ✅ **MEDIUM-HIGH**
- `jscontroller="YQvg8b"` appears to be a stable internal identifier
- Less likely to change than minified CSS classes

**Pattern Stability:** ✅ **HIGH**
- The pattern of adding/removing classes on speaking state is consistent
- Even if class names change, the pattern should remain

## Recommendations

1. **Primary Detection:** Use `jscontroller="YQvg8b"` as the base selector
2. **Class Monitoring:** Watch for any class additions/removals as fallback
3. **Periodic Testing:** Verify detection still works after Google Meet updates
4. **Fallback Strategy:** If `wEsLMd` class no longer works, monitor all class changes on `[jscontroller="YQvg8b"]` elements

## Testing Notes

- Tested with 1 participant (self)
- Response time: ~100ms between speaking and class change
- No false positives observed during testing session
- Classes update smoothly during continuous speech

## Next Steps

- [ ] Test with multiple participants in a call
- [ ] Verify pattern works across different Google Meet UI themes
- [ ] Extract participant names/identifiers
- [ ] Implement production speaker tracker
- [ ] Set up automated tests for pattern verification
- [ ] Monitor for Google Meet updates that break detection

---

**Research conducted using:** Platform Research Extension v0.1.0
**Total logs collected:** 200+ DOM mutations
**Session duration:** ~20 seconds of speaking activity
