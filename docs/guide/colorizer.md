# Colorizer in the local native desktop host

Open an IFC file, then choose **Author → Colorizer**. Its groups load
automatically. The tool uses the open file; a file selector appears only when
multiple IFC models are loaded. It does not require the Model workspace or edit
mode because it previews colours and saves a separate copy. Shared-session
editing roles and workflow locks still apply.
This tool requires the local native desktop host; the web viewer has no
Colorizer runtime yet.

1. Click **Paint whole model gray** to replace existing surface colours.
2. Choose **Section**, find a section such as `PIPE-267.4X8`, tick its row, and
   click **Apply colour**. Ticking groups also highlights their objects in 3D.
   The default paint is red. **Paint 3D selection**
   applies the chosen colour to objects selected in the viewer: Ctrl+click to
   select several independent members, choose a colour, then click that button.
   Members can belong to different sections/groups. Only selected members of
   the chosen IFC file are painted; other models are kept separate.
   Right-click an object or an existing selection and choose **Colour selection**
   for a quick swatch or custom colour. It uses the same draft and Undo history.
3. Use **Undo** and **Redo** to revise the preview. **Restore original colours**
   is under **More options**.
4. Click **Save as** to download a new file. Open that file to keep
   working with its saved colours.

The preview is a draft owned by the Colorizer panel. Clicking its ribbon button
again collapses it without opening Properties or losing the draft. Reopen it
with the same button. Switching to another panel or removing/replacing its
source discards the draft. Use **Save as** to save the colours;
the ordinary IFC export does not include this preview. Export includes the full
selected model, including hidden objects, plus its existing property/entity,
georeference and schedule edits. It does not merge other loaded models.

Grouping also supports IFC class, material, storey, and exact property paths
such as `Pset_BeamCommon.Reference` or attributes such as `@Name`. Section
discovery prefers the supplied property, material profile, geometry profile,
section properties, element type, then occurrence attributes. Changing **Group
by** updates the list automatically and retains the draft without uploading
unchanged preview colours again. **Transparency (%)** sits beside the colour
picker. **More options** contains section-property overrides, automatic colours and
palette save/load. Palette JSON files store uniform colours by group name and grouping
mode; partially painted groups must be painted uniformly before saving a palette.

Colour overrides replace surface colour, indexed face colours and surface
textures on the painted items. Curve/axis presentation, geometric parameters,
placements and physical material definitions are retained. Shared mapped
representations are split only where owners need different colours. The Rust
core supports STEP IFC2X3, IFC4 and IFC4X3, including IFC2X3 transparency through
`IfcSurfaceStyleRendering`.

Preview uses the viewer's opaque colour overlay. **Transparency (%)**
controls the saved IFC; it does not simulate transparency in this preview.
Existing textured meshes can retain their pattern under the preview tint.
Open the exported file to review the actual transparency and texture removal.

Automatic reading needs the original IFC file or a complete source-backed model.
A source-less restored model must be reloaded from IFC first. A changed source
is read again automatically. **Try again** retries a failed read. Cancel closes
the temporary native session; **Try again** resumes reading. No Python or IfcOpenShell
installation is required at runtime.
