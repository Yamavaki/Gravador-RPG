'use strict';
// Fila de exportação: uma por vez (o FFmpeg já usa a placa/CPU inteira),
// com progresso, cancelar e histórico.

const { EventEmitter } = require('events');

let seq = 0;

class Fila extends EventEmitter {
  constructor({ maxHistorico = 30 } = {}) {
    super();
    this.tarefas = [];
    this.rodando = null;
    this.maxHistorico = maxHistorico;
  }

  /**
   * tarefa: { titulo, preset, executar(aoProgresso) → { promessa, cancelar } }
   * A promessa resolve com { saida, avisos }.
   */
  adicionar(tarefa) {
    const t = {
      id: 'e' + (++seq) + '-' + Date.now().toString(36),
      titulo: tarefa.titulo || 'Exportação',
      preset: tarefa.preset || '',
      estado: 'espera',
      progresso: 0,
      saida: tarefa.saida || '',
      erro: '',
      avisos: tarefa.avisos || [],
      criada: Date.now(),
      _executar: tarefa.executar,
      _arquivos: tarefa.arquivos || [],
      _descartar: tarefa.descartar || null,
    };
    this.tarefas.push(t);
    this._mudou();
    this._proxima();
    return t.id;
  }

  cancelar(id) {
    const t = this.tarefas.find(x => x.id === id);
    if (!t) return false;
    if (t.estado === 'espera') {
      t.estado = 'cancelado';
      if (t._descartar) { try { t._descartar(); } catch { /* */ } }
      this._mudou();
      return true;
    }
    if (t.estado === 'rodando' && t._cancelar) { t._cancelar(); return true; }
    return false;
  }

  limparConcluidas() {
    this.tarefas = this.tarefas.filter(t => t.estado === 'espera' || t.estado === 'rodando');
    this._mudou();
  }

  lista() {
    return this.tarefas.map(t => ({
      id: t.id, titulo: t.titulo, preset: t.preset, estado: t.estado,
      progresso: t.progresso, saida: t.saida, erro: t.erro, avisos: t.avisos, criada: t.criada,
    }));
  }

  get ocupada() { return !!this.rodando; }

  /** Vídeos de origem das exportações que ainda vão rodar (a limpeza não pode tirar). */
  arquivosEmUso() {
    return this.tarefas.filter(t => t.estado === 'espera' || t.estado === 'rodando').flatMap(t => t._arquivos);
  }

  _mudou() {
    // histórico limitado: tira os concluídos mais antigos
    const feitos = this.tarefas.filter(t => !['espera', 'rodando'].includes(t.estado));
    if (feitos.length > this.maxHistorico) {
      const tirar = new Set(feitos.slice(0, feitos.length - this.maxHistorico));
      this.tarefas = this.tarefas.filter(t => !tirar.has(t));
    }
    this.emit('mudou', this.lista());
  }

  async _proxima() {
    if (this.rodando) return;
    const t = this.tarefas.find(x => x.estado === 'espera');
    if (!t) return;
    this.rodando = t;
    t.estado = 'rodando';
    this._mudou();
    let ultimo = 0;
    try {
      const job = await t._executar(p => {
        t.progresso = p;
        // não inunda a interface: avisa a cada 1%
        if (p - ultimo >= 0.01 || p === 1) { ultimo = p; this._mudou(); }
      }, cancelar => { t._cancelar = cancelar; });
      t.estado = 'pronto';
      t.progresso = 1;
      t.saida = (job && job.saida) || '';
      if (job && job.avisos) t.avisos = [...new Set([...t.avisos, ...job.avisos])];
      this.emit('pronta', t);
    } catch (e) {
      t.estado = e && e.cancelado ? 'cancelado' : 'erro';
      t.erro = e && e.cancelado ? '' : String((e && e.message) || e);
    } finally {
      t._cancelar = null;
      this.rodando = null;
      this._mudou();
      setImmediate(() => this._proxima());
    }
  }
}

module.exports = { Fila };
