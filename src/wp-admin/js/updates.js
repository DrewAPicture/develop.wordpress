/**
 * Functions for ajaxified updates, deletions and installs inside the WordPress admin.
 *
 * @version 4.2.0
 *
 * @package WordPress
 * @subpackage Administration
 */

/* global pagenow */

/**
 * @param {jQuery}  $                                   jQuery object.
 * @param {object}  wp                                  WP object.
 * @param {object}  settings                            WP Updates settings.
 * @param {string}  settings.ajax_nonce                 AJAX nonce.
 * @param {object}  settings.l10n                       Translation strings.
 * @param {object=} settings.plugins                    Base names of plugins in their different states.
 * @param {Array}   settings.plugins.all                Base names of all plugins.
 * @param {Array}   settings.plugins.active             Base names of active plugins.
 * @param {Array}   settings.plugins.inactive           Base names of inactive plugins.
 * @param {Array}   settings.plugins.upgrade            Base names of plugins with updates available.
 * @param {Array}   settings.plugins.recently_activated Base names of recently activated plugins.
 * @param {object=} settings.totals                     Plugin/theme status information or null.
 * @param {number}  settings.totals.all                 Amount of all plugins or themes.
 * @param {number}  settings.totals.upgrade             Amount of plugins or themes with updates available.
 * @param {number}  settings.totals.disabled            Amount of disabled themes.
 */
(function( $, wp, settings ) {
	var $document = $( document );

	wp = wp || {};

	/**
	 * The WP Updates object.
	 *
	 * @since 4.2.0
	 *
	 * @type {object}
	 */
	wp.updates = {};

	/**
	 * User nonce for ajax calls.
	 *
	 * @since 4.2.0
	 *
	 * @type {string}
	 */
	wp.updates.ajaxNonce = settings.ajax_nonce;

	/**
	 * Localized strings.
	 *
	 * @since 4.2.0
	 *
	 * @type {object}
	 */
	wp.updates.l10n = settings.l10n;

	/**
	 * Whether filesystem credentials need to be requested from the user.
	 *
	 * @since 4.2.0
	 *
	 * @type {bool}
	 */
	wp.updates.shouldRequestFilesystemCredentials = false;

	/**
	 * Filesystem credentials to be packaged along with the request.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 Added `available` property to indicate whether credentials have been provided.
	 *
	 * @type {object} filesystemCredentials                    Holds filesystem credentials.
	 * @type {object} filesystemCredentials.ftp                Holds FTP credentials.
	 * @type {string} filesystemCredentials.ftp.host           FTP host. Default empty string.
	 * @type {string} filesystemCredentials.ftp.username       FTP user name. Default empty string.
	 * @type {string} filesystemCredentials.ftp.password       FTP password. Default empty string.
	 * @type {string} filesystemCredentials.ftp.connectionType Type of FTP connection. 'ssh', 'ftp', or 'ftps'.
	 *                                                         Default empty string.
	 * @type {object} filesystemCredentials.ssh                Holds SSH credentials.
	 * @type {string} filesystemCredentials.ssh.publicKey      The public key. Default empty string.
	 * @type {string} filesystemCredentials.ssh.privateKey     The private key. Default empty string.
	 * @type {bool}   filesystemCredentials.available          Whether filesystem credentials have been provided.
	 *                                                         Default 'false'.
	 */
	wp.updates.filesystemCredentials = {
		ftp:       {
			host:           '',
			username:       '',
			password:       '',
			connectionType: ''
		},
		ssh:       {
			publicKey:  '',
			privateKey: ''
		},
		available: false
	};

	/**
	 * Whether we're waiting for an Ajax request to complete.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 More accurately named `ajaxLocked`.
	 *
	 * @type {bool}
	 */
	wp.updates.ajaxLocked = false;

	/**
	 * Admin notice template.
	 *
	 * @since 4.6.0
	 *
	 * @type {function} A function that lazily-compiles the template requested.
	 */
	wp.updates.adminNotice = wp.template( 'wp-updates-admin-notice' );

	/**
	 * Update queue.
	 *
	 * If the user tries to update a plugin while an update is
	 * already happening, it can be placed in this queue to perform later.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 More accurately named `queue`.
	 *
	 * @type {Array.object}
	 */
	wp.updates.queue = [];

	/**
	 * Holds the URL the user is being redirected to after a successful core update.
	 *
	 * @since 4.6.0
	 *
	 * @type {string}
	 */
	wp.updates.coreUpdateRedirect = undefined;

	/**
	 * Holds a jQuery reference to return focus to when exiting the request credentials modal.
	 *
	 * @since 4.2.0
	 *
	 * @type {jQuery}
	 */
	wp.updates.$elToReturnFocusToFromCredentialsModal = undefined;

	/**
	 * Adds or updates an admin notice.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}  data
	 * @param {*=}      data.selector      Optional. Selector of an element to be replaced with the admin notice.
	 * @param {string=} data.id            Optional. Unique id that will be used as the notice's id attribute.
	 * @param {string=} data.className     Optional. Class names that will be used in the admin notice.
	 * @param {string=} data.message       Optional. The message displayed in the notice.
	 * @param {number=} data.successes     Optional. The amount of successful operations.
	 * @param {number=} data.errors        Optional. The amount of failed operations.
	 * @param {Array=}  data.errorMessages Optional. Error messages of failed operations.
	 *
	 */
	wp.updates.addAdminNotice = function( data ) {
		var $notice = $( data.selector ), $adminNotice;

		delete data.selector;
		$adminNotice = wp.updates.adminNotice( data );

		// Check if this admin notice already exists.
		if ( ! $notice.length ) {
			$notice = $( '#' + data.id );
		}

		if ( $notice.length ) {
			$notice.replaceWith( $adminNotice );
		} else {
			$( '.wrap' ).find( '> h1' ).after( $adminNotice );
		}

		$document.trigger( 'wp-updates-notice-added' );
	};

	/**
	 * Handles Ajax requests to WordPress.
	 *
	 * @since 4.6.0
	 *
	 * @param {string} action The type of Ajax request ('update-plugin', 'install-theme', etc).
	 * @param {object} data   Data that needs to be passed to the ajax callback.
	 * @return {$.promise}    A jQuery promise that represents the request,
	 *                        decorated with an abort() method.
	 */
	wp.updates.ajax = function( action, data ) {
		var options = {};

		if ( wp.updates.ajaxLocked ) {
			wp.updates.queue.push( {
				action: action,
				data:   data
			} );

			// Return a Deferred object so callbacks can always be registered.
			return $.Deferred();
		}

		wp.updates.ajaxLocked = true;

		if ( data.success ) {
			options.success = data.success;
			delete data.success;
		}

		if ( data.error ) {
			options.error = data.error;
			delete data.error;
		}

		options.data = _.extend( data, {
			action:          action,
			_ajax_nonce:     wp.updates.ajaxNonce,
			username:        wp.updates.filesystemCredentials.ftp.username,
			password:        wp.updates.filesystemCredentials.ftp.password,
			hostname:        wp.updates.filesystemCredentials.ftp.hostname,
			connection_type: wp.updates.filesystemCredentials.ftp.connectionType,
			public_key:      wp.updates.filesystemCredentials.ssh.publicKey,
			private_key:     wp.updates.filesystemCredentials.ssh.privateKey
		} );

		return wp.ajax.send( options ).always( wp.updates.ajaxAlways );
	};

	/**
	 * Actions performed after every Ajax request.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}  response
	 * @param {array=}  response.debug     Optional. Debug information.
	 * @param {string=} response.errorCode Optional. Error code for an error that occurred.
	 */
	wp.updates.ajaxAlways = function( response ) {
		if ( ! response.errorCode && 'unable_to_connect_to_filesystem' !== response.errorCode ) {
			wp.updates.ajaxLocked = false;
			wp.updates.queueChecker();
		}

		if ( 'undefined' !== typeof response.debug ) {
			_.map( response.debug, function( message ) {
				window.console.log( $( '<p />' ).html( message ).text() );
			} );
		}
	};

	/**
	 * Decrements the update counts throughout the various menus.
	 *
	 * This includes the toolbar, the "Updates" menu item and the menu items
	 * for plugins and themes.
	 *
	 * @since 3.9.0
	 *
	 * @param {string} type The type of item that was updated or deleted.
	 *                      Can be 'plugin', 'theme'.
	 */
	wp.updates.decrementCount = function( type ) {
		var $adminBarUpdates             = $( '#wp-admin-bar-updates' ),
		    $dashboardNavMenuUpdateCount = $( 'a[href="update-core.php"] .update-plugins' ),
		    count                        = $adminBarUpdates.find( '.ab-label' ).text(),
		    $menuItem, $itemCount, itemCount;

		count = parseInt( count, 10 ) - 1;

		if ( count < 0 || isNaN( count ) ) {
			return;
		}

		$adminBarUpdates.find( '.ab-item' ).removeAttr( 'title' );
		$adminBarUpdates.find( '.ab-label' ).text( count );

		// Remove the update count from the toolbar if it's zero.
		if ( ! count ) {
			$adminBarUpdates.find( '.ab-label' ).parents( 'li' ).remove();
		}

		// Update the "Updates" menu item.
		$dashboardNavMenuUpdateCount.each( function( index, element ) {
			element.className = element.className.replace( /count-\d+/, 'count-' + count );
		} );

		$dashboardNavMenuUpdateCount.removeAttr( 'title' );
		$dashboardNavMenuUpdateCount.find( '.update-count' ).text( count );

		switch ( type ) {
			case 'plugin':
				$menuItem  = $( '#menu-plugins' );
				$itemCount = $menuItem.find( '.plugin-count' );
				break;

			case 'theme':
				$menuItem  = $( '#menu-appearance' );
				$itemCount = $menuItem.find( '.theme-count' );
				break;

			default:
				window.console.error( '"%s" is not white-listed to have its count decremented.', type );
				return;
		}

		// Decrement the counter of the other menu items.
		if ( $itemCount ) {
			itemCount = $itemCount.eq( 0 ).text();
			itemCount = parseInt( itemCount, 10 ) - 1;
		}

		if ( itemCount < 0 || isNaN( itemCount ) ) {
			return;
		}

		if ( itemCount > 0 ) {
			$( '.subsubsub .upgrade .count' ).text( '(' + itemCount + ')' );

			$itemCount.text( itemCount );
			$menuItem.find( '.update-plugins' ).each( function( index, element ) {
				element.className = element.className.replace( /count-\d+/, 'count-' + itemCount );
			} );
		} else {
			$( '.subsubsub .upgrade' ).remove();
			$menuItem.find( '.update-plugins' ).remove();
		}
	};

	/**
	 * Sends an Ajax request to the server to update a plugin.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 More accurately named `updatePlugin`.
	 *
	 * @param {object}               args         Arguments.
	 * @param {string}               args.plugin  Plugin basename.
	 * @param {string}               args.slug    Plugin slug.
	 * @param {updatePluginSuccess=} args.success Optional. Success callback. Default: wp.updates.updatePluginSuccess
	 * @param {updatePluginError=}   args.error   Optional. Error callback. Default: wp.updates.updatePluginError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.updatePlugin = function( args ) {
		var $updateRow, $card, $message, message;

		args = _.extend( {
			success: wp.updates.updatePluginSuccess,
			error: wp.updates.updatePluginError
		}, args );

		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			$updateRow = $( 'tr[data-plugin="' + args.plugin + '"]' );
			$message   = $updateRow.find( '.update-message' ).addClass( 'updating-message' ).find( 'p' );
			message    = wp.updates.l10n.updatingLabel.replace( '%s', $updateRow.find( '.plugin-title strong' ).text() );
		} else if ( 'plugin-install' === pagenow || 'plugin-install-network' === pagenow ) {
			$card    = $( '.plugin-card-' + args.slug );
			$message = $card.find( '.update-now' ).addClass( 'updating-message' );
			message  = wp.updates.l10n.updatingLabel.replace( '%s', $message.data( 'name' ) );

			// Remove previous error messages, if any.
			$card.removeClass( 'plugin-card-update-failed' ).find( '.notice.notice-error' ).remove();
		} else if ( 'update-core' === pagenow || 'update-core-network' === pagenow ) {
			$message = $( '.update-link[data-plugin="' + args.plugin + '"]' ).addClass( 'updating-message' );
			message  = wp.updates.l10n.updatingLabel.replace( '%s', $message.data( 'name' ) );
		}

		if ( $message.html() !== wp.updates.l10n.updating ) {
			$message.data( 'originaltext', $message.html() );
		}

		$message
			.attr( 'aria-label', message )
			.text( wp.updates.l10n.updating );

		$document.trigger( 'wp-plugin-updating' );

		return wp.updates.ajax( 'update-plugin', args );
	};

	/**
	 * Updates the UI appropriately after a successful plugin update.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 More accurately named `updatePluginSuccess`.
	 *
	 * @typedef {object} updatePluginSuccess
	 * @param {object} response            Response from the server.
	 * @param {string} response.slug       Slug of the plugin to be updated.
	 * @param {string} response.plugin     Basename of the plugin to be updated.
	 * @param {string} response.pluginName Name of the plugin to be updated.
	 * @param {string} response.oldVersion Old version of the plugin.
	 * @param {string} response.newVersion New version of the plugin.
	 */
	wp.updates.updatePluginSuccess = function( response ) {
		var $pluginRow, $updateMessage, newText;

		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			$pluginRow     = $( 'tr[data-plugin="' + response.plugin + '"]' )
				.removeClass( 'update' )
				.addClass( 'updated' );
			$updateMessage = $pluginRow.find( '.update-message' )
				.removeClass( 'updating-message notice-warning' )
				.addClass( 'updated-message notice-success' ).find( 'p' );

			// Update the version number in the row.
			newText = $pluginRow.find( '.plugin-version-author-uri' ).html().replace( response.oldVersion, response.newVersion );
			$pluginRow.find( '.plugin-version-author-uri' ).html( newText );
		} else if ( 'plugin-install' === pagenow || 'plugin-install-network' === pagenow ) {
			$updateMessage = $( '.plugin-card-' + response.slug ).find( '.update-now' )
				.removeClass( 'updating-message' )
				.addClass( 'button-disabled updated-message' );
		}

		$updateMessage
			.attr( 'aria-label', wp.updates.l10n.updatedLabel.replace( '%s', response.pluginName ) )
			.text( wp.updates.l10n.updated );

		wp.a11y.speak( wp.updates.l10n.updatedMsg, 'polite' );

		wp.updates.decrementCount( 'plugin' );

		$document.trigger( 'wp-plugin-update-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed plugin update.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 More accurately named `updatePluginError`.
	 *
	 * @typedef {object} updatePluginError
	 * @param {object}  response              Response from the server.
	 * @param {string}  response.slug         Slug of the plugin to be updated.
	 * @param {string}  response.plugin       Basename of the plugin to be updated.
	 * @param {string=} response.pluginName   Optional. Name of the plugin to be updated.
	 * @param {string}  response.errorCode    Error code for the error that occurred.
	 * @param {string}  response.errorMessage The error that occurred.
	 */
	wp.updates.updatePluginError = function( response ) {
		var $card, $message, errorMessage;

		if ( wp.updates.maybeHandleCredentialError( response, 'update-plugin' ) ) {
			return;
		}

		errorMessage = wp.updates.l10n.updateFailed.replace( '%s', response.errorMessage );

		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			$message = $( 'tr[data-plugin="' + response.plugin + '"]' ).find( '.update-message' );
			$message.removeClass( 'updating-message notice-warning' ).addClass( 'notice-error' ).find( 'p' ).html( errorMessage );
		} else if ( 'plugin-install' === pagenow || 'plugin-install-network' === pagenow ) {
			$card = $( '.plugin-card-' + response.slug )
				.addClass( 'plugin-card-update-failed' )
				.append( wp.updates.adminNotice( {
					className: 'update-message notice-error notice-alt is-dismissible',
					message:   errorMessage
				} ) );

			$card.find( '.update-now' )
				.attr( 'aria-label', wp.updates.l10n.updateFailedLabel.replace( '%s', response.pluginName ) )
				.text( wp.updates.l10n.updateFailedShort ).removeClass( 'updating-message' );

			$card.on( 'click', '.notice.is-dismissible .notice-dismiss', function() {

				// Use same delay as the total duration of the notice fadeTo + slideUp animation.
				setTimeout( function() {
					$card
						.removeClass( 'plugin-card-update-failed' )
						.find( '.column-name a' ).focus();

					$card.find( '.update-now' )
						.attr( 'aria-label', false )
						.text( wp.updates.l10n.updateNow );
				}, 200 );
			} );
		}

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-plugin-update-error', response );
	};

	/**
	 * Sends an Ajax request to the server to install a plugin.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}                args         Arguments.
	 * @param {string}                args.slug    Plugin identifier in the WordPress.org Plugin repository.
	 * @param {installPluginSuccess=} args.success Optional. Success callback. Default: wp.updates.installPluginSuccess
	 * @param {installPluginError=}   args.error   Optional. Error callback. Default: wp.updates.installPluginError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.installPlugin = function( args ) {
		var $card    = $( '.plugin-card-' + args.slug ),
		    $message = $card.find( '.install-now' );

		args = _.extend( {
			success: wp.updates.installPluginSuccess,
			error: wp.updates.installPluginError
		}, args );

		if ( 'import' === pagenow ) {
			$message = $( 'a[href*="' + args.slug + '"]' );
		} else {
			$message.text( wp.updates.l10n.installing );
		}

		$message.addClass( 'updating-message' );

		wp.a11y.speak( wp.updates.l10n.installingMsg, 'polite' );

		// Remove previous error messages, if any.
		$card.removeClass( 'plugin-card-install-failed' ).find( '.notice.notice-error' ).remove();

		return wp.updates.ajax( 'install-plugin', args );
	};

	/**
	 * Updates the UI appropriately after a successful plugin install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installPluginSuccess
	 * @param {object} response             Response from the server.
	 * @param {string} response.slug        Slug of the installed plugin.
	 * @param {string} response.pluginName  Name of the installed plugin.
	 * @param {string} response.activateUrl URL to activate the just installed plugin.
	 */
	wp.updates.installPluginSuccess = function( response ) {
		var $message = $( '.plugin-card-' + response.slug ).find( '.install-now' );

		$message
			.removeClass( 'updating-message' )
			.addClass( 'updated-message installed button-disabled' )
			.text( wp.updates.l10n.installed );

		wp.a11y.speak( wp.updates.l10n.installedMsg, 'polite' );

		$document.trigger( 'wp-plugin-install-success', response );

		if ( response.activateUrl ) {
			setTimeout( function() {

				// Transform the 'Install' button into an 'Activate' button.
				$message.removeClass( 'install-now installed button-disabled updated-message' ).addClass( 'activate-now button-primary' )
					.attr( 'href', response.activateUrl )
					.text( wp.updates.l10n.activate );
			}, 1000 );
		}
	};

	/**
	 * Updates the UI appropriately after a failed plugin install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installPluginError
	 * @param {object}  response              Response from the server.
	 * @param {string}  response.slug         Slug of the plugin to be installed.
	 * @param {string=} response.pluginName   Optional. Name of the plugin to be installed.
	 * @param {string}  response.errorCode    Error code for the error that occurred.
	 * @param {string}  response.errorMessage The error that occurred.
	 */
	wp.updates.installPluginError = function( response ) {
		var $card   = $( '.plugin-card-' + response.slug ),
		    $button = $card.find( '.install-now' ),
		    errorMessage;

		if ( wp.updates.maybeHandleCredentialError( response, 'install-plugin' ) ) {
			return;
		}

		errorMessage = wp.updates.l10n.installFailed.replace( '%s', response.errorMessage );

		$card
			.addClass( 'plugin-card-update-failed' )
			.append( '<div class="notice notice-error notice-alt is-dismissible"><p>' + errorMessage + '</p></div>' );

		$card.on( 'click', '.notice.is-dismissible .notice-dismiss', function() {

			// Use same delay as the total duration of the notice fadeTo + slideUp animation.
			setTimeout( function() {
				$card
					.removeClass( 'plugin-card-update-failed' )
					.find( '.column-name a' ).focus();
			}, 200 );
		} );

		$button
			.removeClass( 'updating-message' ).addClass( 'button-disabled' )
			.attr( 'aria-label', wp.updates.l10n.installFailedLabel.replace( '%s', response.pluginName ) )
			.text( wp.updates.l10n.installFailedShort );

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-plugin-install-error', response );
	};

	/**
	 * Updates the UI appropriately after a successful importer install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installImporterSuccess
	 * @param {object} response             Response from the server.
	 * @param {string} response.slug        Slug of the installed plugin.
	 * @param {string} response.pluginName  Name of the installed plugin.
	 * @param {string} response.activateUrl URL to activate the just installed plugin.
	 */
	wp.updates.installImporterSuccess = function( response ) {
		wp.updates.addAdminNotice( {
			id:        'install-success',
			className: 'notice-success is-dismissible',
			message:   wp.updates.l10n.importerInstalledMsg.replace( '%s', response.activateUrl + '&from=import' )
		} );

		$( 'a[href*="' + response.slug + '"]' )
			.removeClass( 'thickbox open-plugin-details-modal updating-message' )
			.off( 'click' )
			.attr( 'href', response.activateUrl + '&from=import' )
			.attr( 'title', wp.updates.l10n.activateImporter );

		wp.a11y.speak( wp.updates.l10n.installedMsg, 'polite' );

		$document.trigger( 'wp-installer-install-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed importer install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installImporterError
	 * @param {object}  response              Response from the server.
	 * @param {string}  response.slug         Slug of the plugin to be installed.
	 * @param {string=} response.pluginName   Optional. Name of the plugin to be installed.
	 * @param {string}  response.errorCode    Error code for the error that occurred.
	 * @param {string}  response.errorMessage The error that occurred.
	 */
	wp.updates.installImporterError = function( response ) {
		var errorMessage = wp.updates.l10n.installFailed.replace( '%s', response.errorMessage );

		if ( wp.updates.maybeHandleCredentialError( response, 'install-plugin' ) ) {
			return;
		}

		wp.updates.addAdminNotice( {
			id:        response.errorCode,
			className: 'notice-error is-dismissible',
			message:   errorMessage
		} );

		$( 'a[href*="' + response.slug + '"]' ).removeClass( 'updating-message' );

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-importer-install-error', response );
	};

	/**
	 * Sends an Ajax request to the server to delete a plugin.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}               args         Arguments.
	 * @param {string}               args.plugin  Basename of the plugin to be deleted.
	 * @param {string}               args.slug    Slug of the plugin to be deleted.
	 * @param {deletePluginSuccess=} args.success Optional. Success callback. Default: wp.updates.deletePluginSuccess
	 * @param {deletePluginError=}   args.error   Optional. Error callback. Default: wp.updates.deletePluginError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.deletePlugin = function( args ) {
		var $message = $( '[data-plugin="' + args.plugin + '"]' ).find( '.update-message p' );

		args = _.extend( {
			success: wp.updates.deletePluginSuccess,
			error: wp.updates.deletePluginError
		}, args );

		if ( $message.html() !== wp.updates.l10n.updating ) {
			$message.data( 'originaltext', $message.html() );
		}

		wp.a11y.speak( wp.updates.l10n.deleting, 'polite' );

		return wp.updates.ajax( 'delete-plugin', args );
	};

	/**
	 * Updates the UI appropriately after a successful plugin deletion.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} deletePluginSuccess
	 * @param {object} response            Response from the server.
	 * @param {string} response.slug       Slug of the plugin that was deleted.
	 * @param {string} response.plugin     Base name of the plugin that was deleted.
	 * @param {string} response.pluginName Name of the plugin that was deleted.
	 */
	wp.updates.deletePluginSuccess = function( response ) {

		// Removes the plugin and updates rows.
		$( '[data-plugin="' + response.plugin + '"]' ).css( { backgroundColor: '#faafaa' } ).fadeOut( 350, function() {
			var $form            = $( '#bulk-action-form' ),
			    $views           = $( '.subsubsub' ),
			    $pluginRow       = $( this ),
			    columnCount      = $form.find( 'thead th:not(.hidden), thead td' ).length,
			    pluginDeletedRow = wp.template( 'item-deleted-row' ),
			    /** @type {object} plugins Base names of plugins in their different states. */
			    plugins          = settings.plugins;

			// Add a success message after deleting a plugin.
			if ( ! $pluginRow.hasClass( 'plugin-update-tr' ) ) {
				$pluginRow.after(
					pluginDeletedRow( {
						slug:    response.slug,
						plugin:  response.plugin,
						colspan: columnCount,
						name:    response.pluginName
					} )
				);
			}

			$pluginRow.remove();

			// Remove plugin from update count.
			if ( -1 !== _.indexOf( plugins.upgrade, response.plugin ) ) {
				plugins.upgrade = _.without( plugins.upgrade, response.plugin );
				wp.updates.decrementCount( 'plugin' );
			}

			// Remove from views.
			if ( -1 !== _.indexOf( plugins.inactive, response.plugin ) ) {
				plugins.inactive = _.without( plugins.inactive, response.plugin );
				if ( plugins.inactive.length ) {
					$views.find( '.inactive .count' ).text( '(' + plugins.inactive.length + ')' );
				} else {
					$views.find( '.inactive' ).remove();
				}
			}

			if ( -1 !== _.indexOf( plugins.active, response.plugin ) ) {
				plugins.active = _.without( plugins.active, response.plugin );
				if ( plugins.active.length ) {
					$views.find( '.active .count' ).text( '(' + plugins.active.length + ')' );
				} else {
					$views.find( '.active' ).remove();
				}
			}

			if ( -1 !== _.indexOf( plugins.recently_activated, response.plugin ) ) {
				plugins.recently_activated = _.without( plugins.recently_activated, response.plugin );
				if ( plugins.recently_activated.length ) {
					$views.find( '.recently_activated .count' ).text( '(' + plugins.recently_activated.length + ')' );
				} else {
					$views.find( '.recently_activated' ).remove();
				}
			}

			plugins.all = _.without( plugins.all, response.plugin );

			if ( plugins.all.length ) {
				$views.find( '.all .count' ).text( '(' + plugins.all.length + ')' );
			} else {
				$form.find( '.tablenav' ).css( { visibility: 'hidden' } );
				$views.find( '.all' ).remove();

				if ( ! $form.find( 'tr.no-items' ).length ) {
					$form.find( '#the-list' ).append( '<tr class="no-items"><td class="colspanchange" colspan="' + columnCount + '">' + wp.updates.l10n.noPlugins + '</td></tr>' );
				}
			}
		} );

		wp.a11y.speak( wp.updates.l10n.deleted, 'polite' );

		$document.trigger( 'wp-plugin-delete-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed plugin deletion.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} deletePluginError
	 * @param {object}  response              Response from the server.
	 * @param {string}  response.slug         Slug of the plugin to be deleted.
	 * @param {string}  response.plugin       Base name of the plugin to be deleted
	 * @param {string=} response.pluginName   Optional. Name of the plugin to be deleted.
	 * @param {string}  response.errorCode    Error code for the error that occurred.
	 * @param {string}  response.errorMessage The error that occurred.
	 */
	wp.updates.deletePluginError = function( response ) {
		var $plugin          = $( 'tr.inactive[data-plugin="' + response.plugin + '"]' ),
		    pluginUpdateRow  = wp.template( 'item-update-row' ),
		    $pluginUpdateRow = $plugin.siblings( '[data-plugin="' + response.plugin + '"]' ),
		    noticeContent    = wp.updates.adminNotice( {
			    className: 'update-message notice-error notice-alt',
			    message:   response.errorMessage
		    } );

		if ( wp.updates.maybeHandleCredentialError( response, 'delete-plugin' ) ) {
			return;
		}

		// Add a plugin update row if it doesn't exist yet.
		if ( ! $pluginUpdateRow.length ) {
			$plugin.addClass( 'update' ).after(
				pluginUpdateRow( {
					slug:    response.slug,
					plugin:  response.plugin,
					colspan: $( '#bulk-action-form' ).find( 'thead th:not(.hidden), thead td' ).length,
					content: noticeContent
				} )
			);
		} else {

			// Remove previous error messages, if any.
			$pluginUpdateRow.find( '.notice-error' ).remove();

			$pluginUpdateRow.find( '.plugin-update' ).append( noticeContent );
		}

		$document.trigger( 'wp-plugin-delete-error', response );
	};

	/**
	 * Sends an Ajax request to the server to update a theme.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}              args         Arguments.
	 * @param {string}              args.slug    Theme stylesheet.
	 * @param {updateThemeSuccess=} args.success Optional. Success callback. Default: wp.updates.updateThemeSuccess
	 * @param {updateThemeError=}   args.error   Optional. Error callback. Default: wp.updates.updateThemeError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.updateTheme = function( args ) {
		var $notice;

		args = _.extend( {
			success: wp.updates.updateThemeSuccess,
			error: wp.updates.updateThemeError
		}, args );

		if ( 'update-core' === pagenow || 'update-core-network' === pagenow ) {
			$notice = $( '.update-link', '[data-slug="' + args.slug + '"]' ).addClass( 'updating-message' );

		} else if ( 'themes-network' === pagenow ) {
			$notice = $( '[data-slug="' + args.slug + '"]' ).find( '.update-message' ).addClass( 'updating-message' ).find( 'p' );

		} else {
			$notice = $( '#update-theme' ).closest( '.notice' );
			if ( ! $notice.length ) {
				$notice = $( '[data-slug="' + args.slug + '"]' ).find( '.update-message' );
			}

			$notice.find( 'h3' ).remove();
			$notice = $notice.removeClass( 'notice-large' ).addClass( 'updating-message' ).find( 'p' );
		}

		if ( $notice.html() !== wp.updates.l10n.updating ) {
			$notice.data( 'originaltext', $notice.html() );
		}

		wp.a11y.speak( wp.updates.l10n.updatingMsg, 'polite' );
		$notice.text( wp.updates.l10n.updating );

		return wp.updates.ajax( 'update-theme', args );
	};

	/**
	 * Updates the UI appropriately after a successful theme update.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} updateThemeSuccess
	 * @param {object} response
	 * @param {string} response.slug       Slug of the theme to be updated.
	 * @param {object} response.theme      Updated theme.
	 * @param {string} response.oldVersion Old version of the theme.
	 * @param {string} response.newVersion New version of the theme.
	 */
	wp.updates.updateThemeSuccess = function( response ) {
		var isModalOpen    = $( 'body.modal-open' ).length,
		    $theme         = $( '[data-slug="' + response.slug + '"]' ),
		    updatedMessage = {
		    	className: 'updated-message notice-success notice-alt',
		    	message:   wp.updates.l10n.updated
		    },
		    $notice, newText;

		if ( 'themes-network' === pagenow ) {
			$notice = $theme.find( '.update-message' );

			// Update the version number in the row.
			newText = $theme.find( '.theme-version-author-uri' ).html().replace( response.oldVersion, response.newVersion );
			$theme.find( '.theme-version-author-uri' ).html( newText );
		} else {
			$notice = $( '.theme-info .notice' );
			if ( ! $notice.length ) {
				$notice = $theme.find( '.update-message' );
			}

			// Focus on Customize button after updating.
			if ( isModalOpen ) {
				$( '.load-customize:visible' ).focus();
			} else {
				$theme.find( '.load-customize' ).focus();
			}
		}

		wp.updates.addAdminNotice( _.extend( { selector: $notice }, updatedMessage ) );
		wp.a11y.speak( wp.updates.l10n.updatedMsg, 'polite' );

		wp.updates.decrementCount( 'theme' );

		$document.trigger( 'wp-theme-update-success', response );

		// Show updated message after modal re-rendered.
		if ( isModalOpen ) {
			$( '.theme-info .theme-author' ).after( wp.updates.adminNotice( updatedMessage ) );
		}
	};

	/**
	 * Updates the UI appropriately after a failed theme update.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} updateThemeError
	 * @param {object} response              Response from the server.
	 * @param {string} response.slug         Slug of the theme to be updated.
	 * @param {string} response.errorCode    Error code for the error that occurred.
	 * @param {string} response.errorMessage The error that occurred.
	 */
	wp.updates.updateThemeError = function( response ) {
		var $theme       = $( '[data-slug="' + response.slug + '"]' ),
		    errorMessage = wp.updates.l10n.updateFailed.replace( '%s', response.errorMessage ),
		    $notice;

		if ( wp.updates.maybeHandleCredentialError( response, 'update-theme' ) ) {
			return;
		}

		if ( 'themes-network' === pagenow ) {
			$notice = $theme.find( '.update-message ' );
		} else {
			$notice = $( '.theme-info .notice' );
			if ( ! $notice.length ) {
				$notice = $theme.find( '.notice' );
			}
			$( 'body.modal-open' ).length ? $( '.load-customize:visible' ).focus() : $theme.find( '.load-customize' ).focus();
		}

		wp.updates.addAdminNotice( {
			selector:  $notice,
			className: 'update-message notice-error notice-alt is-dismissible',
			message:   errorMessage
		} );

		wp.a11y.speak( errorMessage, 'polite' );

		$document.trigger( 'wp-theme-update-error', response );
	};

	/**
	 * Sends an Ajax request to the server to install a theme.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}               args
	 * @param {string}               args.slug    Theme stylesheet.
	 * @param {installThemeSuccess=} args.success Optional. Success callback. Default: wp.updates.installThemeSuccess
	 * @param {installThemeError=}   args.error   Optional. Error callback. Default: wp.updates.installThemeError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.installTheme = function( args ) {
		var $message = $( '.theme-install[data-slug="' + args.slug + '"]' );

		args = _.extend( {
			success: wp.updates.installThemeSuccess,
			error: wp.updates.installThemeError
		}, args );

		$message.addClass( 'updating-message' );
		$message.parents( '.theme' ).addClass( 'focus' );
		if ( $message.html() !== wp.updates.l10n.installing ) {
			$message.data( 'originaltext', $message.html() );
		}

		$message.text( wp.updates.l10n.installing );
		wp.a11y.speak( wp.updates.l10n.installingMsg, 'polite' );

		// Remove previous error messages, if any.
		$( '.install-theme-info, [data-slug="' + args.slug + '"]' ).removeClass( 'theme-install-failed' ).find( '.notice.notice-error' ).remove();

		return wp.updates.ajax( 'install-theme', args );
	};

	/**
	 * Updates the UI appropriately after a successful theme install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installThemeSuccess
	 * @param {object} response      Response from the server.
	 * @param {string} response.slug Slug of the theme to be installed.
	 */
	wp.updates.installThemeSuccess = function( response ) {
		var $card    = $( '.wp-full-overlay-header, [data-slug=' + response.slug + ']' ),
		    $message = $card.find( '.theme-install' );

		$message
			.removeClass( 'updating-message' )
			.addClass( 'updated-message disabled' );

		$message.text( wp.updates.l10n.installed );
		wp.a11y.speak( wp.updates.l10n.installedMsg, 'polite' );

		$card.addClass( 'is-installed' ).removeClass( 'focus' ); // Hides the button.

		$document.trigger( 'wp-install-theme-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed theme install.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} installThemeError
	 * @param {object} response              Response from the server.
	 * @param {string} response.slug         Slug of the theme to be installed.
	 * @param {string} response.errorCode    Error code for the error that occurred.
	 * @param {string} response.errorMessage The error that occurred.
	 */
	wp.updates.installThemeError = function( response ) {
		var $card, $button,
		    errorMessage = wp.updates.l10n.installFailed.replace( '%s', response.errorMessage ),
		    $message     = wp.updates.adminNotice( {
			    className: 'update-message notice-error notice-alt',
			    message:   errorMessage
		    } );

		if ( wp.updates.maybeHandleCredentialError( response, 'install-theme' ) ) {
			return;
		}

		if ( $document.find( 'body' ).hasClass( 'full-overlay-active' ) ) {
			$button = $( '.theme-install[data-slug="' + response.slug + '"]' );
			$card   = $( '.install-theme-info' ).prepend( $message );
		} else {
			$card   = $( '[data-slug="' + response.slug + '"]' ).removeClass( 'focus' ).addClass( 'theme-install-failed' ).append( $message );
			$button = $card.find( '.theme-install' );
		}

		$button
			.removeClass( 'updating-message' )
			.attr( 'aria-label', wp.updates.l10n.installFailedLabel.replace( '%s', $card.find( '.theme-name' ).text() ) )
			.text( wp.updates.l10n.installFailedShort );

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-theme-install-error', response );
	};

	/**
	 * Sends an Ajax request to the server to install a theme.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}              args
	 * @param {string}              args.slug    Theme stylesheet.
	 * @param {deleteThemeSuccess=} args.success Optional. Success callback. Default: wp.updates.deleteThemeSuccess
	 * @param {deleteThemeError=}   args.error   Optional. Error callback. Default: wp.updates.deleteThemeError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.deleteTheme = function( args ) {
		var $button = $( '.theme-actions .delete-theme' );

		args = _.extend( {
			success: wp.updates.deleteThemeSuccess,
			error: wp.updates.deleteThemeError
		}, args );

		if ( $button.html() !== wp.updates.l10n.deleting ) {
			$button.data( 'originaltext', $button.html() );
		}

		$button.text( wp.updates.l10n.deleting );
		wp.a11y.speak( wp.updates.l10n.deleting, 'polite' );

		// Remove previous error messages, if any.
		$( '.theme-info .update-message' ).remove();

		return wp.updates.ajax( 'delete-theme', args );
	};

	/**
	 * Updates the UI appropriately after a successful theme deletion.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} deleteThemeSuccess
	 * @param {object} response      Response from the server.
	 * @param {string} response.slug Slug of the theme that was deleted.
	 */
	wp.updates.deleteThemeSuccess = function( response ) {
		var $themeRows = $( '[data-slug="' + response.slug + '"]' );

		if ( 'themes-network' === pagenow ) {

			// Removes the theme and updates rows.
			$themeRows.css( { backgroundColor: '#faafaa' } ).fadeOut( 350, function() {
				var $views     = $( '.subsubsub' ),
				    $themeRow  = $( this ),
				    totals     = settings.totals,
				    deletedRow = wp.template( 'item-deleted-row' );

				if ( ! $themeRow.hasClass( 'plugin-update-tr' ) ) {
					$themeRow.after(
						deletedRow( {
							slug:    response.slug,
							colspan: $( '#bulk-action-form' ).find( 'thead th:not(.hidden), thead td' ).length,
							name:    $themeRow.find( '.theme-title strong' ).text()
						} )
					);
				}

				$themeRow.remove();

				// Remove theme from update count.
				if ( $themeRow.hasClass( 'update' ) ) {
					totals.upgrade--;
					wp.updates.decrementCount( 'theme' );
				}

				// Remove from views.
				if ( $themeRow.hasClass( 'inactive' ) ) {
					totals.disabled--;
					if ( totals.disabled ) {
						$views.find( '.disabled .count' ).text( '(' + totals.disabled + ')' );
					} else {
						$views.find( '.disabled' ).remove();
					}
				}

				// There is always at least one theme available.
				$views.find( '.all .count' ).text( '(' + --totals.all + ')' );
			} );
		}

		wp.a11y.speak( wp.updates.l10n.deleted, 'polite' );

		$document.trigger( 'wp-delete-theme-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed theme deletion.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} deleteThemeError
	 * @param {object} response              Response from the server.
	 * @param {string} response.slug         Slug of the theme to be deleted.
	 * @param {string} response.errorCode    Error code for the error that occurred.
	 * @param {string} response.errorMessage The error that occurred.
	 */
	wp.updates.deleteThemeError = function( response ) {
		var $themeRow    = $( 'tr.inactive[data-slug="' + response.slug + '"]' ),
		    $button      = $( '.theme-actions .delete-theme' ),
		    updateRow    = wp.template( 'item-update-row' ),
		    $updateRow   = $themeRow.siblings( '#' + response.slug + '-update' ),
		    errorMessage = wp.updates.l10n.deleteFailed.replace( '%s', response.errorMessage ),
		    $message     = wp.updates.adminNotice( {
			    className: 'update-message notice-error notice-alt',
			    message:   errorMessage
		    } );

		if ( wp.updates.maybeHandleCredentialError( response, 'delete-theme' ) ) {
			return;
		}

		if ( 'themes-network' === pagenow ) {
			if ( ! $updateRow.length ) {
				$themeRow.addClass( 'update' ).after(
					updateRow( {
						slug: response.slug,
						colspan: $( '#bulk-action-form' ).find( 'thead th:not(.hidden), thead td' ).length,
						content: $message
					} )
				);
			} else {
				// Remove previous error messages, if any.
				$updateRow.find( '.notice-error' ).remove();
				$updateRow.find( '.plugin-update' ).append( $message );
			}
		} else {
			$( '.theme-info .theme-description' ).before( $message );
		}

		$button.html( $button.data( 'originaltext' ) );

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-theme-delete-error', response );
	};

	/**
	 * Sends an Ajax request to the server to update WordPress core.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}             args           Arguments.
	 * @param {string}             args.version   The version to update to.
	 * @param {string}             args.locale    The locale to get the update for.
	 * @param {boolean}            args.reinstall Whether this is a reinstall request or not.
	 * @param {updateItemSuccess=} args.success   Optional. Success callback. Default: wp.updates.updateItemSuccess
	 * @param {updateItemError=}   args.error     Optional. Error callback. Default: wp.updates.updateItemError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.updateCore = function( args ) {
		var $message;

		args = _.extend( {
			success: wp.updates.updateItemSuccess,
			error: wp.updates.updateItemError
		}, args );

		$message = $( '[data-type="core"]' ).filter( function() {
			var $coreRow = $( this );

			return args.reinstall && $coreRow.is( '.wordpress-reinstall-card-item' ) ||
				! args.reinstall && ! $coreRow.is( '.wordpress-reinstall-card-item' ) && args.locale === $coreRow.data( 'locale' );
		} ).find( '.update-link' );

		if ( $message.html() !== wp.updates.l10n.updating ) {
			$message.data( 'originaltext', $message.html() );
		}

		$message.addClass( 'updating-message' )
			.attr( 'aria-label', wp.updates.l10n.updatingCoreLabel )
			.text( wp.updates.l10n.updating );

		// Core updates should always come last to redirect to the about page.
		if ( wp.updates.queue.length ) {
			wp.updates.queue.push( {
				action: 'update-core',
				data:   args
			} );

			return wp.updates.queueChecker();
		}

		return wp.updates.ajax( 'update-core', args );
	};

	/**
	 * Sends an Ajax request to the server to update translations.
	 *
	 * @since 4.6.0
	 *
	 * @param {object}             args         Arguments.
	 * @param {updateItemSuccess=} args.success Optional. Success callback. Default: wp.updates.updateItemSuccess
	 * @param {updateItemError=}   args.error   Optional. Error callback. Default: wp.updates.updateItemError
	 * @return {$.promise} A jQuery promise that represents the request,
	 *                     decorated with an abort() method.
	 */
	wp.updates.updateTranslations = function( args ) {
		var $message = $( '[data-type="translations"]' ).find( '.update-link' );

		args = _.extend( {
			success: wp.updates.updateItemSuccess,
			error: wp.updates.updateItemError
		}, args );

		if ( $message.html() !== wp.updates.l10n.updating ) {
			$message.data( 'originaltext', $message.html() );
		}

		$message.addClass( 'updating-message' )
			.attr( 'aria-label', wp.updates.l10n.updatingTranslationsLabel )
			.text( wp.updates.l10n.updating );

		return wp.updates.ajax( 'update-translations', args );
	};

	/**
	 * Sends an Ajax request to the server to install a single item.
	 *
	 * Adds the update item to the queue where the right update handler will be called.
	 *
	 * @since 4.6.0
	 *
	 * @param {jQuery} $itemRow jQuery object of the item to be updated.
	 */
	wp.updates.updateItem = function( $itemRow ) {
		var type   = $itemRow.data( 'type' ),
		    update = {
		    	action: 'update-' + type,
		    	data:   {
		    		success: wp.updates.updateItemSuccess,
		    		error:   wp.updates.updateItemError
		    	}
		    };

		switch ( type ) {
			case 'plugin':
				update.data.plugin = $itemRow.data( 'plugin' );
				update.data.slug   = $itemRow.data( 'slug' );
				break;

			case 'theme':
				update.data.slug = $itemRow.data( 'slug' );
				break;

			case 'core':

				// The update queue should only ever contain one core update.
				if ( _.findWhere( wp.updates.queue, { action: 'update-core' } ) ) {
					return;
				}

				update.data.version   = $itemRow.data( 'version' );
				update.data.locale    = $itemRow.data( 'locale' );
				update.data.reinstall = !! $itemRow.data( 'reinstall' );
				break;
		}

		wp.updates.queue.push( update );
		wp.updates.queueChecker();
	};

	/**
	 * Updates the UI appropriately after a successful update of an item.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} updateItemSuccess
	 * @param {object}  response            Response from the server.
	 * @param {string}  response.update     The type of update. 'core', 'plugin', 'theme', or 'translations'.
	 * @param {string=} response.slug       Optional. Slug of the theme or plugin that was updated.
	 * @param {string=} response.reinstall  Optional. Whether this was a reinstall request or not.
	 * @param {string=} response.redirect   Optional. URL to redirect to after updating Core.
	 * @param {string=} response.plugin     Optional. Basename of the plugin that was updated.
	 * @param {string=} response.pluginName Optional. Name of the plugin that was updated.
	 * @param {string=} response.oldVersion Optional. Old version of the theme or plugin.
	 * @param {string=} response.newVersion Optional. New version of the theme or plugin.
	 * @param {string=} response.locale     Optional. The locale of the requested core upgrade.
	 */
	wp.updates.updateItemSuccess = function( response ) {
		var type = response.update,
		    $row = $( '[data-type="' + type + '"]' );

		if ( 'plugin' === type || 'theme' === type ) {
			$row = $row.filter( '[data-slug="' + response.slug + '"]' );

			wp.updates.decrementCount( type );
		} else if ( 'core' === type ) {
			$row = $row.filter( function() {
				var $coreRow = $( this );

				return 'reinstall' === response.reinstall && $coreRow.is( '.wordpress-reinstall-card-item' ) ||
					'reinstall' !== response.reinstall && ! $coreRow.is( '.wordpress-reinstall-card-item' ) && response.locale === $coreRow.data( 'locale' );
			} );
		}

		$row.find( '.update-link' )
			.removeClass( 'updating-message' )
			.addClass( 'updated-message' )
			.attr( 'aria-label', wp.updates.l10n.updated )
			.prop( 'disabled', true )
			.text( wp.updates.l10n.updated );

		wp.a11y.speak( wp.updates.l10n.updatedMsg, 'polite' );

		if ( 'core' === type && response.redirect ) {
			wp.updates.coreUpdateRedirect = response.redirect;
		}

		$document.trigger( 'wp-' + type + '-update-success', response );
	};

	/**
	 * Updates the UI appropriately after a failed update of an item.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} updateItemError
	 * @param {object}  response              Response from the server.
	 * @param {string}  response.update       The type of update. 'core', 'plugin', 'theme', or 'translations'.
	 * @param {string}  response.errorCode    Error code for the error that occurred.
	 * @param {string}  response.errorMessage The error that occurred.
	 * @param {string=} response.slug         Optional. Slug of the theme or plugin that was updated.
	 * @param {string=} response.plugin       Optional. Basename of the plugin that was updated.
	 * @param {string=} response.pluginName   Optional. Name of the plugin that was updated.
	 * @param {string=} response.reinstall    Optional. Whether this was a reinstall request or not.
	 * @param {string=} response.locale       Optional. The locale of the requested core upgrade.
	 */
	wp.updates.updateItemError = function( response ) {
		var type = response.update,
		    $row = $( '[data-type="' + type + '"]' ),
		    errorMessage = wp.updates.l10n.updateFailed.replace( '%s', response.errorMessage );

		if ( wp.updates.maybeHandleCredentialError( response, 'update-' + response.update ) ) {
			return;
		}

		if ( 'plugin' === type || 'theme' === type ) {
			$row = $row.filter( '[data-slug="' + response.slug + '"]' );
		} else if ( 'core' === type ) {
			$row = $row.filter( function() {
				var $coreRow = $( this );

				return 'reinstall' === response.reinstall && $coreRow.is( '.wordpress-reinstall-card-item' ) ||
					'reinstall' !== response.reinstall && ! $coreRow.is( '.wordpress-reinstall-card-item' ) && response.locale === $coreRow.data( 'locale' );
			} );
		}

		$row.find( '.update-link' )
			.removeClass( 'updating-message' )
			.attr( 'aria-label', wp.updates.l10n.updateFailedShort )
			.prop( 'disabled', true )
			.text( wp.updates.l10n.updateFailedShort );

		wp.updates.addAdminNotice( {
			id:        response.errorCode,
			className: 'notice-error is-dismissible',
			message:   errorMessage
		} );

		wp.a11y.speak( errorMessage, 'assertive' );

		$document.trigger( 'wp-' + type + '-update-error', response );
	};

	/**
	 * Adds the appropriate callback based on the type of action and the current page.
	 *
	 * @since 4.6.0
	 * @private
	 *
	 * @param {object} data   AJAX payload.
	 * @param {string} action The type of request to perform.
	 * @return {object} The AJAX payload with the appropriate callbacks.
	 */
	wp.updates._addCallbacks = function( data, action ) {
		if ( 'update-core' === pagenow || 'update-core-network' === pagenow ) {
			data.success = wp.updates.updateItemSuccess;
			data.error   = wp.updates.updateItemError;

		} else if ( 'import' === pagenow && 'install-plugin' === action ) {
			data.success = wp.updates.installImporterSuccess;
			data.error   = wp.updates.installImporterError;
		}

		return data;
	};

	/**
	 * Pulls available jobs from the queue and runs them.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 Can handle multiple job types.
	 */
	wp.updates.queueChecker = function() {
		var job;

		if ( wp.updates.ajaxLocked || ! wp.updates.queue.length ) {
			return;
		}

		job = wp.updates.queue.shift();

		// Handle a queue job.
		switch ( job.action ) {
			case 'install-plugin':
				wp.updates.installPlugin( job.data );
				break;

			case 'update-plugin':
				wp.updates.updatePlugin( job.data );
				break;

			case 'delete-plugin':
				wp.updates.deletePlugin( job.data );
				break;

			case 'install-theme':
				wp.updates.installTheme( job.data );
				break;

			case 'update-theme':
				wp.updates.updateTheme( job.data );
				break;

			case 'delete-theme':
				wp.updates.deleteTheme( job.data );
				break;

			case 'update-core':
				wp.updates.updateCore( job.data );
				break;

			case 'update-translations':
				wp.updates.updateTranslations( job.data );
				break;

			default:
				window.console.error( 'Failed to execute queued update job.', job );
				break;
		}
	};

	/**
	 * Requests the users filesystem credentials if they aren't already known.
	 *
	 * @since 4.2.0
	 *
	 * @param {Event=} event Optional. Event interface.
	 */
	wp.updates.requestFilesystemCredentials = function( event ) {
		if ( false === wp.updates.filesystemCredentials.available ) {
			/*
			 * After exiting the credentials request modal,
			 * return the focus to the element triggering the request.
			 */
			if ( event && ! wp.updates.$elToReturnFocusToFromCredentialsModal ) {
				wp.updates.$elToReturnFocusToFromCredentialsModal = $( event.target );
			}

			wp.updates.ajaxLocked = true;
			wp.updates.requestForCredentialsModalOpen();
		}
	};

	/**
	 * Requests the users filesystem credentials if needed and there is no lock.
	 *
	 * @since 4.6.0
	 *
	 * @param {Event=} event Optional. Event interface.
	 */
	wp.updates.maybeRequestFilesystemCredentials = function( event ) {
		if ( wp.updates.shouldRequestFilesystemCredentials && ! wp.updates.ajaxLocked ) {
			wp.updates.requestFilesystemCredentials( event );
		}
	};

	/**
	 * Keydown handler for the request for credentials modal.
	 *
	 * Closes the modal when the escape key is pressed and
	 * constrains keyboard navigation to inside the modal.
	 *
	 * @since 4.2.0
	 *
	 * @param {Event} event Event interface.
	 */
	wp.updates.keydown = function( event ) {
		if ( 27 === event.keyCode ) {
			wp.updates.requestForCredentialsModalCancel();
		} else if ( 9 === event.keyCode ) {

			// #upgrade button must always be the last focus-able element in the dialog.
			if ( 'upgrade' === event.target.id && ! event.shiftKey ) {
				$( '#hostname' ).focus();

				event.preventDefault();
			} else if ( 'hostname' === event.target.id && event.shiftKey ) {
				$( '#upgrade' ).focus();

				event.preventDefault();
			}
		}
	};

	/**
	 * Opens the request for credentials modal.
	 *
	 * @since 4.2.0
	 */
	wp.updates.requestForCredentialsModalOpen = function() {
		var $modal = $( '#request-filesystem-credentials-dialog' );

		$( 'body' ).addClass( 'modal-open' );
		$modal.show();
		$modal.find( 'input:enabled:first' ).focus();
		$modal.on( 'keydown', wp.updates.keydown );
	};

	/**
	 * Closes the request for credentials modal.
	 *
	 * @since 4.2.0
	 */
	wp.updates.requestForCredentialsModalClose = function() {
		$( '#request-filesystem-credentials-dialog' ).hide();
		$( 'body' ).removeClass( 'modal-open' );

		if ( wp.updates.$elToReturnFocusToFromCredentialsModal ) {
			wp.updates.$elToReturnFocusToFromCredentialsModal.focus();
		}
	};

	/**
	 * Takes care of the steps that need to happen when the modal is canceled out.
	 *
	 * @since 4.2.0
	 * @since 4.6.0 Triggers an event for callbacks to listen to and add their actions.
	 */
	wp.updates.requestForCredentialsModalCancel = function() {

		// Not ajaxLocked and no queue means we already have cleared things up.
		if ( ! wp.updates.ajaxLocked && ! wp.updates.queue.length ) {
			return;
		}

		_.each( wp.updates.queue, function( job ) {
			$document.trigger( 'credential-modal-cancel', job );
		} );

		// Remove the lock, and clear the queue.
		wp.updates.ajaxLocked = false;
		wp.updates.queue = [];

		wp.updates.requestForCredentialsModalClose();
	};

	/**
	 * Displays an error message in the request for credentials form.
	 *
	 * @since 4.2.0
	 *
	 * @param {string} message Error message.
	 */
	wp.updates.showErrorInCredentialsForm = function( message ) {
		var $modal = $( '#request-filesystem-credentials-form' );

		// Remove any existing error.
		$modal.find( '.notice' ).remove();
		$modal.find( '#request-filesystem-credentials-title' ).after( '<div class="notice notice-alt notice-error"><p>' + message + '</p></div>' );
	};

	/**
	 * Handles credential errors and runs events that need to happen in that case.
	 *
	 * @since 4.2.0
	 *
	 * @param {object} response Ajax response.
	 * @param {string} action   The type of request to perform.
	 */
	wp.updates.credentialError = function( response, action ) {

		// Restore callbacks.
		response = wp.updates._addCallbacks( response, action );

		wp.updates.queue.push( {
			action: action,

			/*
			 * Not cool that we're depending on response for this data.
			 * This would feel more whole in a view all tied together.
			 */
			data: response
		} );

		wp.updates.filesystemCredentials.available = false;
		wp.updates.showErrorInCredentialsForm( response.errorMessage );
		wp.updates.requestFilesystemCredentials();
	};

	/**
	 * Handles credentials errors if it could not connect to the filesystem.
	 *
	 * @since 4.6.0
	 *
	 * @typedef {object} maybeHandleCredentialError
	 * @param {object} response              Response from the server.
	 * @param {string} response.errorCode    Error code for the error that occurred.
	 * @param {string} response.errorMessage The error that occurred.
	 * @param {string} action                The type of request to perform.
	 * @returns {boolean} Whether there is an error that needs to be handled or not.
	 */
	wp.updates.maybeHandleCredentialError = function( response, action ) {
		if ( response.errorCode && 'unable_to_connect_to_filesystem' === response.errorCode ) {
			wp.updates.credentialError( response, action );
			return true;
		}

		return false;
	};

	/**
	 * Potentially adds an AYS to a user attempting to leave the page.
	 *
	 * If an update is on-going and a user attempts to leave the page,
	 * opens an "Are you sure?" alert.
	 *
	 * @since 4.2.0
	 */
	wp.updates.beforeunload = function() {
		if ( wp.updates.ajaxLocked ) {
			return wp.updates.l10n.beforeunload;
		}
	};

	$( function() {
		var $theList         = $( '#the-list' ),
		    $pluginFilter    = $( '#plugin-filter' ),
		    $bulkActionForm  = $( '#bulk-action-form' ),
		    $filesystemModal = $( '#request-filesystem-credentials-dialog' );

		/*
		 * Whether a user needs to submit filesystem credentials.
		 *
		 * This is based on whether the form was output on the page server-side.
		 *
		 * @see {wp_print_request_filesystem_credentials_modal() in PHP}
		 */
		wp.updates.shouldRequestFilesystemCredentials = $filesystemModal.length > 0;

		/**
		 * File system credentials form submit noop-er / handler.
		 *
		 * @since 4.2.0
		 */
		$filesystemModal.on( 'submit', 'form', function( event ) {
			event.preventDefault();

			// Persist the credentials input by the user for the duration of the page load.
			wp.updates.filesystemCredentials.ftp.hostname       = $( '#hostname' ).val();
			wp.updates.filesystemCredentials.ftp.username       = $( '#username' ).val();
			wp.updates.filesystemCredentials.ftp.password       = $( '#password' ).val();
			wp.updates.filesystemCredentials.ftp.connectionType = $( 'input[name="connection_type"]:checked' ).val();
			wp.updates.filesystemCredentials.ssh.publicKey      = $( '#public_key' ).val();
			wp.updates.filesystemCredentials.ssh.privateKey     = $( '#private_key' ).val();
			wp.updates.filesystemCredentials.available          = true;

			// Unlock and invoke the queue.
			wp.updates.ajaxLocked = false;
			wp.updates.queueChecker();

			wp.updates.requestForCredentialsModalClose();
		} );

		/**
		 * Closes the request credentials modal when clicking the 'Cancel' button or outside of the modal.
		 *
		 * @since 4.2.0
		 */
		$filesystemModal.on( 'click', '[data-js-action="close"], .notification-dialog-background', wp.updates.requestForCredentialsModalCancel );

		/**
		 * Hide SSH fields when not selected.
		 *
		 * @since 4.2.0
		 */
		$filesystemModal.on( 'change', 'input[name="connection_type"]', function() {
			$( '#ssh-keys' ).toggleClass( 'hidden', ( 'ssh' !== $( this ).val() ) );
		} ).change();

		/**
		 * Handles events after the credential modal was closed.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event}  event Event interface.
		 * @param {string} job   The install/update.delete request.
		 */
		$document.on( 'credential-modal-cancel', function( event, job ) {
			var $updatingMessage = $( '.updating-message' ),
			    $message, originalText;

			if ( 'update-core' === pagenow || 'update-core-network' === pagenow ) {
				$updatingMessage.removeClass( 'updating-message' ).text( function() {
					return $( this ).data( 'originaltext' );
				} );
			} else if ( 'import' === pagenow ) {
				$updatingMessage.removeClass( 'updating-message' );
			} else if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
				$message = $( 'tr[data-plugin="' + job.data.plugin + '"]' ).find( '.update-message' );
			} else if ( 'plugin-install' === pagenow || 'plugin-install-network' === pagenow ) {
				$message = $( '.update-now.updating-message' );
			} else {
				$message = $updatingMessage;
			}

			if ( $message ) {
				originalText = $message.data( 'originaltext' );

				if ( 'undefined' === typeof originalText ) {
					originalText = $( '<p>' ).html( $message.find( 'p' ).data( 'originaltext' ) );
				}

				$message
					.removeClass( 'updating-message' )
				    .html( originalText );
			}

			wp.a11y.speak( wp.updates.l10n.updateCancel, 'polite' );
		} );

		/**
		 * Click handler for plugin updates in List Table view.
		 *
		 * @since 4.2.0
		 *
		 * @param {Event} event Event interface.
		 */
		$bulkActionForm.on( 'click', '[data-plugin] .update-link', function( event ) {
			var $message   = $( event.target ),
			    $pluginRow = $message.parents( 'tr' );

			event.preventDefault();

			if ( $message.hasClass( 'updating-message' ) || $message.hasClass( 'button-disabled' ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			// Return the user to the input box of the plugin's table row after closing the modal.
			wp.updates.$elToReturnFocusToFromCredentialsModal = $pluginRow.find( '.check-column input' );
			wp.updates.updatePlugin( {
				plugin: $pluginRow.data( 'plugin' ),
				slug:   $pluginRow.data( 'slug' )
			} );
		} );

		/**
		 * Click handler for plugin updates in plugin install view.
		 *
		 * @since 4.2.0
		 *
		 * @param {Event} event Event interface.
		 */
		$pluginFilter.on( 'click', '.update-now', function( event ) {
			var $button = $( event.target );
			event.preventDefault();

			if ( $button.hasClass( 'updating-message' ) || $button.hasClass( 'button-disabled' ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			wp.updates.updatePlugin( {
				plugin: $button.data( 'plugin' ),
				slug:   $button.data( 'slug' )
			} );
		} );

		/**
		 * Click handler for plugin installs in plugin install view.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$pluginFilter.on( 'click', '.install-now', function( event ) {
			var $button = $( event.target );
			event.preventDefault();

			if ( $button.hasClass( 'updating-message' ) || $button.hasClass( 'button-disabled' ) ) {
				return;
			}

			if ( wp.updates.shouldRequestFilesystemCredentials && ! wp.updates.ajaxLocked ) {
				wp.updates.requestFilesystemCredentials( event );

				$document.on( 'credential-modal-cancel', function() {
					var $message = $( '.install-now.updating-message' );

					$message
						.removeClass( 'updating-message' )
						.text( wp.updates.l10n.installNow );

					wp.a11y.speak( wp.updates.l10n.updateCancel, 'polite' );
				} );
			}

			wp.updates.installPlugin( {
				slug: $button.data( 'slug' )
			} );
		} );

		/**
		 * Click handler for plugin deletions.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$bulkActionForm.on( 'click', '[data-plugin] a.delete', function( event ) {
			var $pluginRow = $( event.target ).parents( 'tr' );

			event.preventDefault();

			if ( ! window.confirm( wp.updates.l10n.aysDeleteUninstall.replace( '%s', $pluginRow.find( '.plugin-title strong' ).text() ) ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			wp.updates.deletePlugin( {
				plugin: $pluginRow.data( 'plugin' ),
				slug:   $pluginRow.data( 'slug' )
			} );

		} );

		/**
		 * Click handler for theme updates.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$document.on( 'click', '.themes-php.network-admin .update-link', function( event ) {
			var $message  = $( event.target ),
			    $themeRow = $message.parents( 'tr' );

			event.preventDefault();

			if ( $message.hasClass( 'updating-message' ) || $message.hasClass( 'button-disabled' ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			// Return the user to the input box of the theme's table row after closing the modal.
			wp.updates.$elToReturnFocusToFromCredentialsModal = $themeRow.find( '.check-column input' );
			wp.updates.updateTheme( {
				slug: $themeRow.data( 'slug' )
			} );
		} );

		/**
		 * Click handler for theme deletions.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$document.on( 'click', '.themes-php.network-admin a.delete', function( event ) {
			var $themeRow = $( event.target ).parents( 'tr' );

			event.preventDefault();

			if ( ! window.confirm( wp.updates.l10n.aysDelete.replace( '%s', $themeRow.find( '.theme-title strong' ).text() ) ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			wp.updates.deleteTheme( {
				slug: $themeRow.data( 'slug' )
			} );
		} );

		/**
		 * Bulk action handler for plugins and themes.
		 *
		 * Handles both deletions and updates.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$bulkActionForm.on( 'click', '[type="submit"]', function( event ) {
			var bulkAction    = $( event.target ).siblings( 'select' ).val(),
			    itemsSelected = $bulkActionForm.find( 'input[name="checked[]"]:checked' ),
			    success       = 0,
			    error         = 0,
			    errorMessages = [],
			    type, action;

			// Determine which type of item we're dealing with.
			switch ( pagenow ) {
				case 'plugins':
				case 'plugins-network':
					type = 'plugin';
					break;

				case 'themes-network':
					type = 'theme';
					break;

				default:
					window.console.error( 'The page "%s" is not white-listed for bulk action handling.', pagenow );
					return;
			}

			// Bail if there were no items selected.
			if ( ! itemsSelected.length ) {
				event.preventDefault();
				$( 'html, body' ).animate( { scrollTop: 0 } );

				return wp.updates.addAdminNotice( {
					id:        'no-items-selected',
					className: 'notice-error is-dismissible',
					message:   wp.updates.l10n.noItemsSelected
				} );
			}

			// Determine the type of request we're dealing with.
			switch ( bulkAction ) {
				case 'update-selected':
					action = bulkAction.replace( 'selected', type );
					break;

				case 'delete-selected':
					if ( ! window.confirm( 'plugin' === type ? wp.updates.l10n.aysBulkDelete : wp.updates.l10n.aysBulkDeleteThemes ) ) {
						event.preventDefault();
						return;
					}

					action = bulkAction.replace( 'selected', type );
					break;

				default:
					window.console.error( 'Failed to identify bulk action: %s', bulkAction );
					return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			event.preventDefault();

			// Un-check the bulk checkboxes.
			$bulkActionForm.find( '.manage-column [type="checkbox"]' ).prop( 'checked', false );

			// Find all the checkboxes which have been checked.
			itemsSelected.each( function( index, element ) {
				var $checkbox  = $( element ),
				    $itemRow = $checkbox.parents( 'tr' );

				// Un-check the box.
				$checkbox.prop( 'checked', false );

				// Only add update-able items to the update queue.
				if ( 'update-selected' === bulkAction && ( ! $itemRow.hasClass( 'update' ) || $itemRow.find( 'notice-error' ).length ) ) {
					return;
				}

				// Add it to the queue.
				wp.updates.queue.push( {
					action: action,
					data:   {
						plugin: $itemRow.data( 'plugin' ),
						slug:   $itemRow.data( 'slug' )
					}
				} );
			} );

			// Display bulk notification for updates of any kind.
			$document.on( 'wp-plugin-update-success wp-plugin-update-error wp-theme-update-success wp-theme-update-error', function( event, response ) {
				var $bulkActionNotice, itemName;

				if ( 'wp-' + response.update + '-update-success' === event.type ) {
					success++;
				} else {
					itemName = response.pluginName ? response.pluginName : $( '[data-slug="' + response.slug + '"]' ).find( '.theme-title strong' ).text();

					error++;
					errorMessages.push( itemName + ': ' + response.errorMessage );
				}

				wp.updates.adminNotice = wp.template( 'wp-bulk-updates-admin-notice' );

				wp.updates.addAdminNotice( {
					id:            'bulk-action-notice',
					successes:     success,
					errors:        error,
					errorMessages: errorMessages,
					type:          response.update
				} );

				$bulkActionNotice = $( '#bulk-action-notice' ).on( 'click', 'button', function() {
					$bulkActionNotice.find( 'ul' ).toggleClass( 'hidden' );
				} );

				if ( error > 0 && ! wp.updates.queue.length ) {
					$( 'html, body' ).animate( { scrollTop: 0 } );
				}
			} );

			// Reset admin notice template after #bulk-action-notice was added.
			$document.on( 'wp-updates-notice-added', function() {
				wp.updates.adminNotice = wp.template( 'wp-updates-admin-notice' );
			} );

			// Check the queue, now that the event handlers have been added.
			wp.updates.queueChecker();
		} );

		/**
		 * Click handler for updates in the Update List Table view.
		 *
		 * Handles the re-install core button and "Update All" as well.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$( '.update-core-php .update-link' ).on( 'click', function( event ) {
			var $message = $( event.target ),
			    $itemRow = $message.parents( '[data-type]' ),

			    /*
			     * There can be more than one WP update on localized installs.
			     *
			     * This selects the update button of the other available core update, to later determine whether that
			     * update is already running and manipulate that button accordingly.
			     */
			    $otherUpdateCoreButton = $( '.update-link[data-type="core"]' ).not( $message ),
			    $allOtherUpdateButtons = $theList.find( '.update-link:enabled' ).not( $message ),
			    type                   = $itemRow.data( 'type' );

			// Select both 'Update All' buttons.
			if ( 'all' === type ) {
				$message = $( '.update-link[data-type="all"]' );
			}

			event.preventDefault();

			// The item has already been updated, do not proceed.
			if ( ! $message.length || $message.hasClass( 'updated-message' ) || $message.hasClass( 'updating-message' ) || $message.hasClass( 'button-disabled' ) ) {
				return;
			}

			// Bail if there's already another core update going on.
			if ( $otherUpdateCoreButton.hasClass( 'updated-message' ) || $otherUpdateCoreButton.hasClass( 'updating-message' ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			if ( 'all' === type ) {
				if ( $message.html() !== wp.updates.l10n.updating ) {
					$message.data( 'originaltext', $message.html() );
				}

				$message.addClass( 'updating-message' ).attr( 'aria-label', wp.updates.l10n.updatingAllLabel ).text( wp.updates.l10n.updating );

				// Translations first, themes and plugins afterwards before updating core at last.
				$( $( 'tr[data-type]', '#wp-updates-table' ).get().reverse() ).each( function( index, element ) {
					var $itemRow      = $( element ),
					    $updateButton = $itemRow.find( '.update-link' );

					if ( $updateButton.prop( 'disabled' ) ) {
						return;
					}

					// When there are two core updates (en_US + localized), only update the localized one.
					if ( 1 < $( '.update-link[data-type="core"]' ).length && 'core' === $itemRow.data( 'type' ) && 'en_US' === $itemRow.data( 'locale' ) ) {
						$updateButton.prop( 'disabled', true );

						return;
					}

					$updateButton.addClass( 'updating-message' ).text( wp.updates.l10n.updating );

					wp.updates.updateItem( $itemRow );
				} );
			} else {

				/*
				 * Disable all other update buttons if this one is a core update
				 * or if there's no other update left besides the current one.
				 */
				if ( 'core' === type || ! $allOtherUpdateButtons.length ) {
					$allOtherUpdateButtons.prop( 'disabled', true );
				}

				wp.updates.updateItem( $itemRow );
			}
		} );

		/**
		 * Callback for update-core.php when all updates have been processed.
		 *
		 * Handles the redirect after a successful core update and changes the state
		 * of the "Update All" button after all updates have been processed and there
		 * are no new ones available.
		 *
		 * @since 4.6.0
		 */
		$document.on( 'wp-plugin-update-success wp-theme-update-success wp-core-update-success wp-translations-update-success wp-plugin-update-error wp-theme-update-error wp-core-update-error wp-translations-update-error ', function() {
			var $message = $( '.update-link[data-type="all"]' );

			if ( wp.updates.queue.length ) {
				return;
			}

			if ( $message.length && ! $theList.find( '.update-link:not(.updating-message):enabled' ).not( $message ).length ) {
				$message
					.removeClass( 'updating-message' )
					.addClass( 'updated-message' )
					.attr( 'aria-label', wp.updates.l10n.updated )
					.prop( 'disabled', true )
					.text( wp.updates.l10n.updated );
			}

			if ( wp.updates.coreUpdateRedirect ) {
				window.location = wp.updates.coreUpdateRedirect;
			}
		} );

		/**
		 * Handles changes to the plugin search box on the new-plugin page,
		 * searching the repository dynamically.
		 *
		 * @since 4.6.0
		 */
		$( 'input.wp-filter-search' ).on( 'keyup search', _.debounce( function() {
			var $form = $( '#plugin-filter' ).empty(),
			    data = {
			    	_ajax_nonce: wp.updates.ajaxNonce,
			    	s:           $( this ).val(),
			    	tab:         'search',
			    	type:        $( '#typeselector' ).val()
			    };

			if ( 'undefined' !== typeof wp.updates.searchRequest ) {
				wp.updates.searchRequest.abort();
			}
			$( 'body' ).addClass( 'loading-content' );

			wp.updates.searchRequest = wp.ajax.post( 'search-install-plugins', data ).done( function( response ) {
				$( 'body' ).removeClass( 'loading-content' );
				$form.append( response.items );
				delete wp.updates.searchRequest;
			} );
		}, 250 ) );

		/**
		 * Handles changes to the plugin search box on the Installed Plugins screen,
		 * searching the plugin list dynamically.
		 *
		 * @since 4.6.0
		 */
		$( '#plugin-search-input' ).on( 'keyup search', _.debounce( function() {
			var data = {
			    	_ajax_nonce: wp.updates.ajaxNonce,
			    	s:           $( this ).val()
			    };

			if ( 'undefined' !== typeof wp.updates.searchRequest ) {
				wp.updates.searchRequest.abort();
			}

			$bulkActionForm.empty();
			$( 'body' ).addClass( 'loading-content' );

			wp.updates.searchRequest = wp.ajax.post( 'search-plugins', data ).done( function( response ) {

				// Can we just ditch this whole subtitle business?
				var $subTitle    = $( '<span />' ).addClass( 'subtitle' ).html( wp.updates.l10n.searchResults.replace( '%s', data.s ) ),
				    $oldSubTitle = $( '.wrap .subtitle' );

				if ( ! data.s.length ) {
					$oldSubTitle.remove();
				} else if ( $oldSubTitle.length ) {
					$oldSubTitle.replaceWith( $subTitle );
				} else {
					$( '.wrap h1' ).append( $subTitle );
				}

				$( 'body' ).removeClass( 'loading-content' );
				$bulkActionForm.append( response.items );
				delete wp.updates.searchRequest;
			} );
		}, 250 ) );

		/**
		 * Trigger a search event when the search type gets changed.
		 *
		 * @since 4.6.0
		 */
		$( '#typeselector' ).on( 'change', function() {
			$( 'input.wp-filter-search' ).trigger( 'search' );
		} );

		/**
		 * Click handler for updating a plugin from the details modal on `plugin-install.php`.
		 *
		 * @since 4.2.0
		 *
		 * @param {Event} event Event interface.
		 */
		$( '#plugin_update_from_iframe' ).on( 'click', function( event ) {
			var target = window.parent === window ? null : window.parent,
			    update;

			$.support.postMessage = !! window.postMessage;

			if ( false === $.support.postMessage || null === target ) {
				return;
			}

			event.preventDefault();

			update = {
				action: 'update-plugin',
				data:   {
					plugin: $( this ).data( 'plugin' ),
					slug:   $( this ).data( 'slug' )
				}
			};

			target.postMessage( JSON.stringify( update ), window.location.origin );
		} );

		/**
		 * Click handler for installing a plugin from the details modal on `plugin-install.php`.
		 *
		 * @since 4.6.0
		 *
		 * @param {Event} event Event interface.
		 */
		$( '#plugin_install_from_iframe' ).on( 'click', function( event ) {
			var target = window.parent === window ? null : window.parent,
			    install;

			$.support.postMessage = !! window.postMessage;

			if ( false === $.support.postMessage || null === target ) {
				return;
			}

			event.preventDefault();

			install = {
				action: 'install-plugin',
				data:   {
					slug: $( this ).data( 'slug' )
				}
			};

			target.postMessage( JSON.stringify( install ), window.location.origin );
		} );

		/**
		 * Handles postMessage events.
		 *
		 * @since 4.2.0
		 * @since 4.6.0 Switched `update-plugin` action to use the queue.
		 *
		 * @param {Event} event Event interface.
		 */
		$( window ).on( 'message', function( event ) {
			var originalEvent  = event.originalEvent,
			    expectedOrigin = document.location.protocol + '//' + document.location.hostname,
			    message;

			if ( originalEvent.origin !== expectedOrigin ) {
				return;
			}

			message = $.parseJSON( originalEvent.data );

			if ( 'undefined' === typeof message.action ) {
				return;
			}

			switch ( message.action ) {
				/*
				 * Called from `wp-admin/includes/class-wp-upgrader-skins.php`.
				 * @todo Check if that can be removed once this plugin was merged.
				 */
				case 'decrementUpdateCount':
					/** @property {string} message.upgradeType */
					wp.updates.decrementCount( message.upgradeType );
					break;

				case 'install-plugin':
				case 'update-plugin':
					/* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
					window.tb_remove();
					/* jscs:enable */

					message.data = wp.updates._addCallbacks( message.data, message.action );

					wp.updates.queue.push( message );
					wp.updates.queueChecker();
					break;
			}
		} );

		/**
		 * Adds a callback to display a warning before leaving the page.
		 *
		 * @since 4.2.0
		 */
		$( window ).on( 'beforeunload', wp.updates.beforeunload );
	} );
})( jQuery, window.wp, _.extend( window._wpUpdatesSettings, window._wpUpdatesItemCounts || {} ) );
