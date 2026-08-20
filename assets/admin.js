/**
 * Two things, both scoped to the "Generate Theme" form:
 *
 * 1. Pre-fills the Theme Name field with the Design Bundle's own name
 *    (design-bundle.json's meta.figmaFileName) as soon as a bundle .zip
 *    is selected, by reading just that one entry out of the zip directly
 *    in the browser (no dependency, no round-trip to the server). This
 *    used to derive a placeholder-ish default from the *filename*
 *    instead -- but the filename and the bundle's own internal name can
 *    (and did, in practice) drift apart, and worse, whatever ended up in
 *    this field was silently discarded after computing the install
 *    folder slug: the theme's actual displayed "Theme Name:" in
 *    WordPress always came from the bundle's internal name regardless of
 *    what was typed here, with no way to override it. This field is now
 *    genuinely authoritative -- see class-tcf-cli-runner.php's
 *    --theme-name plumbing -- so pre-filling it with the bundle's real
 *    name (rather than a filename guess) is what actually matches what
 *    you'd get if you left it untouched, and editing it afterward now
 *    really does change the generated theme's name.
 *
 *    Falls back to the old filename-derived guess if the browser can't
 *    decompress the bundle (DecompressionStream unsupported), the zip
 *    can't be parsed, or design-bundle.json doesn't contain a usable
 *    name -- this is a UX nicety, not core functionality, and the PHP
 *    side (TCF_Admin_Page::theme_name_from_filename()) already has its
 *    own independent fallback for when JS is off entirely.
 *
 * 2. Shows a "Generating..." overlay with a spinner and rotating status
 *    text while the form submits (see below).
 */
( function () {
	'use strict';

	var ZIP_EOCD_SIGNATURE = 0x06054b50;
	var ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
	var ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

	/**
	 * Reads one named entry out of a zip File's raw bytes, decompressing
	 * it if needed. Hand-rolled rather than pulling in a zip library for
	 * a WordPress admin-page script -- the format needed here (locate the
	 * End Of Central Directory record, walk the central directory to find
	 * an entry by name, jump to its local file header, decompress with
	 * the platform's own DecompressionStream) is a few dozen lines, not
	 * worth a dependency for.
	 *
	 * @param {ArrayBuffer} buffer
	 * @param {string} targetName
	 * @return {Promise<Uint8Array|null>} The entry's decompressed bytes, or null if not found.
	 */
	function readZipEntry( buffer, targetName ) {
		var bytes = new Uint8Array( buffer );
		var view = new DataView( buffer );

		// A zip's central directory can be followed by a comment field up
		// to 65535 bytes long, so the EOCD record isn't necessarily the
		// last 22 bytes of the file -- scan backward through that whole
		// possible window rather than assuming it's right at the end.
		var eocdOffset = -1;
		var searchStart = Math.max( 0, bytes.length - 65557 ); // 22 (EOCD min size) + 65535 (max comment)
		for ( var i = bytes.length - 22; i >= searchStart; i-- ) {
			if ( view.getUint32( i, true ) === ZIP_EOCD_SIGNATURE ) {
				eocdOffset = i;
				break;
			}
		}
		if ( -1 === eocdOffset ) {
			throw new Error( 'Not a valid zip file (no End Of Central Directory record found)' );
		}

		var centralDirOffset = view.getUint32( eocdOffset + 16, true );
		var centralDirEntryCount = view.getUint16( eocdOffset + 10, true );

		var ptr = centralDirOffset;
		for ( var entryIndex = 0; entryIndex < centralDirEntryCount; entryIndex++ ) {
			if ( view.getUint32( ptr, true ) !== ZIP_CENTRAL_DIR_SIGNATURE ) {
				throw new Error( 'Malformed zip central directory' );
			}
			var method = view.getUint16( ptr + 10, true );
			var compressedSize = view.getUint32( ptr + 20, true );
			var nameLen = view.getUint16( ptr + 28, true );
			var extraLen = view.getUint16( ptr + 30, true );
			var commentLen = view.getUint16( ptr + 32, true );
			var localHeaderOffset = view.getUint32( ptr + 42, true );
			var nameBytes = bytes.subarray( ptr + 46, ptr + 46 + nameLen );
			var name = new TextDecoder().decode( nameBytes );

			if ( name === targetName ) {
				// The local file header's own name/extra field lengths
				// can differ from the central directory's -- re-read them
				// here rather than assuming they match.
				if ( view.getUint32( localHeaderOffset, true ) !== ZIP_LOCAL_FILE_SIGNATURE ) {
					throw new Error( 'Malformed zip local file header' );
				}
				var localNameLen = view.getUint16( localHeaderOffset + 26, true );
				var localExtraLen = view.getUint16( localHeaderOffset + 28, true );
				var dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
				var compressed = bytes.slice( dataStart, dataStart + compressedSize );

				if ( 0 === method ) {
					return Promise.resolve( compressed ); // Stored, no decompression needed.
				}
				if ( 8 === method ) {
					if ( 'undefined' === typeof DecompressionStream ) {
						throw new Error( 'This browser cannot decompress zip entries (DecompressionStream unsupported)' );
					}
					var stream = new Blob( [ compressed ] ).stream().pipeThrough( new DecompressionStream( 'deflate-raw' ) );
					return new Response( stream ).arrayBuffer().then( function ( decompressed ) {
						return new Uint8Array( decompressed );
					} );
				}
				throw new Error( 'Unsupported zip compression method: ' + method );
			}

			ptr += 46 + nameLen + extraLen + commentLen;
		}

		return Promise.resolve( null ); // Not found.
	}

	/**
	 * Reads design-bundle.json out of a selected bundle File and returns
	 * its meta.figmaFileName, or null if anything about that didn't work
	 * out (caller falls back to the filename-derived guess either way).
	 *
	 * @param {File} file
	 * @return {Promise<string|null>}
	 */
	function readBundleThemeName( file ) {
		return file.arrayBuffer()
			.then( function ( buffer ) {
				return readZipEntry( buffer, 'design-bundle.json' );
			} )
			.then( function ( entryBytes ) {
				if ( ! entryBytes ) {
					return null;
				}
				var json = JSON.parse( new TextDecoder().decode( entryBytes ) );
				var name = json && json.meta && json.meta.figmaFileName;
				return ( 'string' === typeof name && name.trim() !== '' ) ? name.trim() : null;
			} )
			.catch( function () {
				// Corrupt zip, unexpected shape, decompression unsupported,
				// etc. -- this is a UX nicety, not core functionality, so
				// fail silently and let the caller fall back.
				return null;
			} );
	}

	/**
	 * Title-cases a bundle's filename as a last-resort default when the
	 * bundle's own internal name isn't available (old behavior, kept as
	 * the fallback rather than the primary source now).
	 *
	 * @param {string} fileName
	 * @return {string}
	 */
	function titleCaseFromFileName( fileName ) {
		var base = fileName.replace( /\.(zip|json)$/i, '' );
		base = base.replace( /[-_]/g, ' ' );
		base = base.replace( /\w\S*/g, function ( word ) {
			return word.charAt( 0 ).toUpperCase() + word.substr( 1 ).toLowerCase();
		} );
		return base.trim();
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		var fileInput = document.getElementById( 'tcf_bundle_file' );
		var nameInput = document.getElementById( 'tcf_theme_name' );

		if ( ! fileInput || ! nameInput ) {
			return;
		}

		fileInput.addEventListener( 'change', function () {
			if ( nameInput.value.trim() !== '' ) {
				return; // Don't clobber a name already in the field.
			}

			var file = fileInput.files && fileInput.files[ 0 ];
			if ( ! file ) {
				return;
			}

			readBundleThemeName( file ).then( function ( bundleName ) {
				// Re-check on the way back in, in case the (async) read
				// raced against the user typing something in the meantime.
				if ( nameInput.value.trim() !== '' ) {
					return;
				}
				nameInput.value = bundleName || titleCaseFromFileName( file.name );
			} );
		} );

		// Real feedback for a real synchronous form POST: generation can
		// take anywhere from a few seconds to a couple of minutes (Google
		// Fonts downloads, first-run npm/node startup, larger bundles),
		// and without this the page just sits there looking frozen until
		// the browser's own navigation finally lands -- easy to mistake
		// for "it didn't work" and click away, which is the one thing
		// most likely to actually interrupt a real build. This doesn't
		// (and can't, without switching to an AJAX-driven flow) show real
		// progress; it only proves the click registered and asks the
		// developer to wait it out.
		var form = document.getElementById( 'tcf-generate-form' );
		var overlay = document.getElementById( 'tcf-generating-overlay' );
		var statusEl = document.getElementById( 'tcf-generating-status' );

		if ( ! form || ! overlay ) {
			return;
		}

		var submitting = false;

		form.addEventListener( 'submit', function ( event ) {
			if ( submitting ) {
				// Real (non-AJAX) POST already in flight -- the browser is
				// mid-navigation, so a second submit event here is a stray
				// double click, not a deliberate second run. Swallow it
				// rather than racing two generation jobs against the same
				// theme slug.
				event.preventDefault();
				return;
			}

			submitting = true;
			overlay.hidden = false;

			// Deliberately deferred: disabling the submit button here,
			// synchronously inside the 'submit' handler, would exclude
			// its name=value pair (tcf_generate=1) from the form data the
			// browser is about to construct -- disabled controls aren't
			// submitted, and that construction happens immediately after
			// this handler returns, same synchronous step. That bug
			// shipped in 0.4.1/0.4.2: the button visually disabled, the
			// POST went out without `tcf_generate`, and
			// maybe_handle_submit() bailed out on its very first check
			// with no notice at all -- looked like a fast, silent no-op.
			// A setTimeout(..., 0) pushes the disable to the next tick,
			// after the real submission's entry list is already built,
			// so it still blocks a stray double-click without touching
			// the request that's already in flight.
			var submitButton = form.querySelector( 'button[type="submit"]' );
			if ( submitButton ) {
				window.setTimeout( function () {
					submitButton.disabled = true;
				}, 0 );
			}

			var messages = [
				'Generating your theme...',
				'Still working -- larger bundles and font downloads take longer.',
				'Still going. Please keep this tab open.',
			];
			var messageIndex = 0;

			window.setInterval( function () {
				messageIndex = ( messageIndex + 1 ) % messages.length;
				if ( statusEl ) {
					statusEl.textContent = messages[ messageIndex ];
				}
			}, 6000 );
		} );
	} );
} )();
