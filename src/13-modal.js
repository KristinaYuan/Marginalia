  // ---------------------------------------------------------------------------
  // 13. Modal dialogs (confirm / prompt)
  // ---------------------------------------------------------------------------
  function modal(contentHtml, onAction) {
    ensureUI();
    ui.modal.innerHTML = '<div class="m-modal">' + contentHtml + '</div>';
    ui.modal.style.display = 'flex';
    ui.modal.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        ui.modal.style.display = 'none';
        if (onAction) onAction(act);
      });
    });
  }

  function confirmModal(message, onConfirm) {
    modal(
      '<div class="m-modal-title">Are you sure?</div>' +
      '<p class="m-modal-msg">' + esc(message) + '</p>' +
      '<button class="m-modal-btn m-modal-danger" data-act="ok">Confirm</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>',
      function (act) { if (act === 'ok') onConfirm(); }
    );
  }

  function promptModal(title, initial, onDone) {
    modal(
      '<div class="m-modal-title">' + esc(title) + '</div>' +
      '<input class="m-modal-input" type="text" value="' + esc(initial || '') + '">' +
      '<button class="m-modal-btn" data-act="ok">OK</button>' +
      '<button class="m-modal-btn m-modal-cancel" data-act="cancel">Cancel</button>',
      function (act) {
        if (act === 'ok') {
          var v = ui.modal.querySelector('.m-modal-input').value;
          onDone(v);
        }
      }
    );
  }
