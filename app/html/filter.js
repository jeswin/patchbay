const nest = require('depnest')
const { h, Value, when, computed } = require('mutant')
const Abort = require('pull-abortable')
const pull = require('pull-stream')
const addSuggest = require('suggest-box')
const { isFeed } = require('ssb-ref')
const some = require('lodash/some')
const get = require('lodash/get')
const isEqual = require('lodash/isEqual')

exports.gives = nest('app.html.filter')

exports.needs = nest({
  'channel.async.suggest': 'first',
  'contact.obs.following': 'first',
  'keys.sync.id': 'first',
  'settings.obs.get': 'first',
  'settings.sync.set': 'first'
})

exports.create = function (api) {
  return nest({
    'app.html.filter': Filter
  })

  function Filter (draw) {
    const showFilters = Value(false)

    const myId = api.keys.sync.id()
    const peopleIFollow = api.contact.obs.following(myId)

    const { set } = api.settings.sync

    const filterSettings = api.settings.obs.get('filter', {exclude: {}})

    const channelInput = h('input',
      { value: filterSettings().exclude.channels,
        'ev-keyup': (ev) => {
          var text = ev.target.value
          if (text.length == 0 || ev.which == 13) {
            api.settings.sync.set({
              filter: {
                exclude: {
                  channels: text
                }
              }
            })
            draw()
          }
        }
      }
    )

    const isFiltered = computed(filterSettings, (filterSettings) => {
      const _settings = Object.assign({}, filterSettings)
      delete _settings.defaults

      return !isEqual(_settings, filterSettings.defaults)
    })

    const filterMenu = h('Filter', [
      when(isFiltered, h('i.custom')),
      h('i.fa.fa-filter', {
        classList: when(showFilters, '-active'),
        'ev-click': () => showFilters.set(!showFilters())
      }),
      h('i.fa.fa-angle-up', { 'ev-click': draw }),
      h('div.options', { className: when(showFilters, '', '-hidden') }, [
        h('header', [
          'Filter',
          h('i.fa.fa-filter')
        ]),
        h('section', [
          h('div.channels', [
            h('label', 'Exclude channels'),
            channelInput
          ]),
          toggle({ type: 'peopleIFollow', filterGroup: 'only', label: 'Only people I follow' }),
          h('div.message-types', [
            h('header', 'Show messages'),
            toggle({ type: 'post' }),
            toggle({ type: 'like' }),
            toggle({ type: 'about' }),
            toggle({ type: 'contact' }),
            toggle({ type: 'channel' }),
            toggle({ type: 'pub' }),
            toggle({ type: 'chess' })
          ])
        ])
      ])
    ])

    function toggle ({ type, filterGroup, label }) {
      label = label || type
      filterGroup = filterGroup || 'show'

      const state = computed(filterSettings, settings => get(settings, [filterGroup, type]))
      const handleClick = () => {
        const currentState = state()

        // TODO use some lodash tool ?
        api.settings.sync.set({
          filter: {
            [filterGroup]: {
              [type]: !currentState
            }
          }
        })

        draw()
      }

      return h('FilterToggle', { 'ev-click': handleClick }, [
        h('label', label),
        h('i', { classList: when(state, 'fa fa-check-square-o', 'fa fa-square-o') })
      ])
    }

    const getChannelSuggestions = api.channel.async.suggest()
    addSuggest(channelInput, (inputText, cb) => {
      if (inputText[0] === '#') {
        cb(null, getChannelSuggestions(inputText.slice(1)))
      }
    }, {cls: 'PatchSuggest'})
    channelInput.addEventListener('suggestselect', ev => {
      const channels = channelInput.value.trim()

      api.settings.sync.set({ filter: { exclude: { channels: channels } } })

      draw()
    })

    function followFilter (msg) {
      if (!filterSettings().only.peopleIFollow) return true

      return Array.from(peopleIFollow()).concat(myId).includes(msg.value.author)
    }

    function channelFilter (msg) {
      var filters = filterSettings().exclude.channels
      if (!filters) return true
      filters = filters.split(' ').map(c => c.slice(1))

      return msg.value.content && !filters.includes(msg.value.content.channel)
    }

    function messageFilter (msg) {
      var { type } = msg.value.content
      if (/^chess/.test(type)) {
        type = 'chess'
      }

      return get(filterSettings(), ['show', type], true)
    }

    var downScrollAborter

    function filterDownThrough () {
      return pull(
        downScrollAborter,
        pull.filter(followFilter),
        pull.filter(channelFilter),
        pull.filter(messageFilter)
      )
    }

    var upScrollAborter

    function filterUpThrough () {
      return pull(
        upScrollAborter,
        pull.filter(followFilter),
        pull.filter(channelFilter),
        pull.filter(messageFilter)
      )
    }

    function resetFeed ({ container, content }) {
      if (typeof upScrollAborter === 'function') {
        upScrollAborter.abort()
        downScrollAborter.abort()
      }
      upScrollAborter = Abort()
      downScrollAborter = Abort()

      container.scroll(0)
      content.innerHTML = ''
    }

    return {
      filterMenu,
      filterDownThrough,
      filterUpThrough,
      resetFeed
    }
  }
}
