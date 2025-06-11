/**
 * rich-text-editor.js
 * Sistema di gestione degli editor di testo ricco
 * per l'applicazione Di Dio Training
 */

// Inizializza tutti gli editor di testo ricco nella pagina
function initRichTextEditors() {
    console.log('Inizializzazione editor di testo ricco');
    
    // Trova tutti gli editor nel DOM
    const editors = document.querySelectorAll('.rich-text-editor');
    if (!editors.length) {
        console.warn('Nessun editor di testo ricco trovato nella pagina');
        return;
    }
    
    console.log(`${editors.length} editor trovati, inizializzazione...`);
    
    // Inizializza ogni editor
    editors.forEach(editor => {
        // Assicurati che sia contenteditable
        if (editor.getAttribute('contenteditable') !== 'true') {
            editor.setAttribute('contenteditable', 'true');
        }
        
        // Gestione placeholder
        const placeholder = editor.getAttribute('data-placeholder');
        if (placeholder && editor.innerHTML.trim() === '') {
            editor.innerHTML = `<span class="placeholder">${placeholder}</span>`;
        }
        
        // Evento focus: rimuovi placeholder
        editor.addEventListener('focus', function() {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl) {
                this.innerHTML = '';
            }
        });
        
        // Evento blur: ripristina placeholder se vuoto
        editor.addEventListener('blur', function() {
            if (this.innerHTML.trim() === '' || this.innerHTML === '<br>') {
                this.innerHTML = `<span class="placeholder">${placeholder}</span>`;
            }
        });
        
        // Evento input: rimuovi placeholder durante l'editing
        editor.addEventListener('input', function() {
            const placeholderEl = this.querySelector('.placeholder');
            if (placeholderEl) {
                placeholderEl.remove();
            }
        });
        
        // Impedisci l'invio di tasto Enter senza Shift per evitare di inviare il form accidentalmente
        editor.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Inserisci un line break al posto dell'invio del form
                e.preventDefault();
                document.execCommand('insertLineBreak');
            }
        });
    });
    
    // Inizializza le barre degli strumenti
    initializeToolbars();
}

// Inizializza le barre degli strumenti per la formattazione
function initializeToolbars() {
    const toolbarButtons = document.querySelectorAll('.rich-text-toolbar button');
    
    toolbarButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Trova l'editor associato alla barra degli strumenti corrente
            const toolbar = this.closest('.rich-text-toolbar');
            const container = toolbar.closest('.rich-text-container');
            const editor = container.querySelector('.rich-text-editor');
            
            if (!editor) {
                console.warn('Editor non trovato per la barra degli strumenti');
                return;
            }
            
            // Metti il focus sull'editor per assicurarsi che il comando venga applicato
            editor.focus();
            
            // Esegui il comando di formattazione
            const command = this.getAttribute('onclick')?.match(/formatText\(['"](.+?)['"]\)/)?.[1];
            if (command) {
                formatText(command);
            }
        });
    });
}

// Funzione per formattare il testo
function formatText(command, value = null) {
    document.execCommand(command, false, value);
}

// Funzione per ottenere il contenuto di un editor
function getRichTextContent(editorId) {
    const editor = document.getElementById(editorId);
    if (!editor) {
        console.warn(`Editor con ID ${editorId} non trovato`);
        return '';
    }
    
    // Clona l'editor per manipolare il contenuto senza modificare l'originale
    const clone = editor.cloneNode(true);
    
    // Rimuovi elementi placeholder
    const placeholder = clone.querySelector('.placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    return clone.innerHTML.trim();
}

// Funzione per impostare il contenuto di un editor
function setRichTextContent(editorId, content) {
    const editor = document.getElementById(editorId);
    if (!editor) {
        console.warn(`Editor con ID ${editorId} non trovato`);
        return;
    }
    
    // Se il contenuto è vuoto, mostra il placeholder
    if (!content || content.trim() === '') {
        const placeholder = editor.getAttribute('data-placeholder');
        if (placeholder) {
            editor.innerHTML = `<span class="placeholder">${placeholder}</span>`;
        } else {
            editor.innerHTML = '';
        }
        return;
    }
    
    // Altrimenti, imposta il contenuto
    editor.innerHTML = content;
}

// Esponi le funzioni globalmente
window.initRichTextEditors = initRichTextEditors;
window.formatText = formatText;
window.getRichTextContent = getRichTextContent;
window.setRichTextContent = setRichTextContent;

// Inizializza automaticamente gli editor quando il DOM è caricato
document.addEventListener('DOMContentLoaded', function() {
    initRichTextEditors();
});