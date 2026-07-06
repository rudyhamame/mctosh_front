// Classic "mirror div" technique: clones the text field's box/font metrics
// into a hidden div, inserts a marker at the caret position, and measures
// where that marker landed. Works for both <input> and <textarea>.
const MIRRORED_PROPERTIES = [
  "direction", "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing", "tabSize",
];

export function getCaretCoordinates(el, position) {
  const div = document.createElement("div");
  div.id = "predict_caret_mirror";
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(el);
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "-9999px";
  style.left = "-9999px";

  MIRRORED_PROPERTIES.forEach((prop) => { style[prop] = computed[prop]; });

  if (el.tagName === "INPUT") style.whiteSpace = "pre";

  div.textContent = el.value.substring(0, position);
  if (el.tagName === "INPUT") div.textContent = div.textContent.replace(/\s/g, " ");

  const span = document.createElement("span");
  span.textContent = el.value.substring(position) || ".";
  div.appendChild(span);

  const coordinates = {
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    height: parseInt(computed.lineHeight, 10) || span.offsetHeight,
  };

  document.body.removeChild(div);
  return coordinates;
}
