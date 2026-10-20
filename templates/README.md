# Vita template contract

Bundled Rover designs use nbconvert Nunjucks delimiters: `((( value )))`,
`((* for/if tags *))`, and `((= comments =))`. Normal outputs are automatically
LaTeX escaped. Preserve the template's typography and layout knobs.

`header.contact` provides the original `label`, `value`, optional `url`, and
computed `href` and `display`. Prefer short display text without a label prefix:

```tex
((* for contact in header.contact *))
((* if contact.href *))
\href{((( contact.href | url )))}{((( contact.display )))}
((* else *))
((( contact.display )))
((* endif *))
((* endfor *))
```

Load `hyperref` with `hidelinks` and `microtype`. Always apply the `url` filter
to href targets; it allows only http(s), mailto and tel and escapes URL-sensitive
TeX characters. Use normal automatic escaping for labels and display text.

Each entry has `item.links`, an array of `{ label, url }` pairs, resolved by the
engine at render time from source evidence. A resume may explicitly override it
(up to four links); `[]` hides links. Models do not choose links. Render them in
small type immediately after the title, before any right-aligned dates:

```tex
((* for link in item.links *))
\href{((( link.url | url )))}{((( link.label )))}
((* if not loop.last *)) \enspace|\enspace ((* endif *))
((* endfor *))
```

Templates receive visible `sections`, each with `items`, `detailItems`,
`plainItems`, and `paragraphs`, plus resolved `layout` knob values. The letter
header uses the same computed contact fields. Text checks compare bullets, so
header and entry link labels are independent of claim text.
