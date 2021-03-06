import React from 'react'
import moment from 'moment'
import { observable, action, computed } from 'mobx'
import { inject, observer } from 'mobx-react'
import { messages } from '../messages'
import { sendTransactionByVotingKey } from '../helpers'
import swal from 'sweetalert2'

const ACCEPT = 1
const REJECT = 2
const USDateTimeFormat = 'MM/DD/YYYY h:mm:ss A'
const maxDetailsLength = 500

const zeroTimeTo = '00:00'

@inject('commonStore', 'contractsStore', 'routing', 'ballotsStore')
@observer
export class BallotCard extends React.Component {
  @observable startTime
  @observable endTime
  @observable timeTo = {}
  @observable
  timeToStart = {
    val: 0,
    displayValue: zeroTimeTo,
    title: 'To start'
  }
  @observable
  timeToFinish = {
    val: 0,
    displayValue: zeroTimeTo,
    title: 'To close'
  }
  @observable creatorMiningKey
  @observable creator
  @observable progress
  @observable totalVoters
  @observable isFinalized
  @observable canBeFinalized
  @observable hasAlreadyVoted
  @observable memo

  @computed
  get finalizeButtonDisplayName() {
    const displayName = this.isFinalized ? 'Finalized' : 'Finalize ballot'
    return displayName
  }

  @computed
  get finalizeButtonClass() {
    const cls = this.isFinalized
      ? 'btn btn-primary btn-finalize disabled text-capitalize'
      : 'btn btn-primary btn-finalize text-capitalize'
    return cls
  }

  @computed
  get finalizeDescription() {
    if (this.isFinalized) {
      return ''
    }
    let description = 'Finalization is available after ballot time is finished'
    if (this.canBeFinalized !== null) {
      description += ' or all validators are voted'
    }
    return description
  }

  @computed
  get votesForNumber() {
    let votes = (this.totalVoters + this.progress) / 2
    if (isNaN(votes)) votes = 0
    return votes
  }

  @computed
  get votesForPercents() {
    if (this.totalVoters <= 0) {
      return 0
    }

    let votesPercents = Math.round((this.votesForNumber / this.totalVoters) * 100)
    if (isNaN(votesPercents)) votesPercents = 0
    return votesPercents
  }

  @computed
  get votesAgainstNumber() {
    let votes = (this.totalVoters - this.progress) / 2
    if (isNaN(votes)) votes = 0
    return votes
  }

  @computed
  get votesAgainstPercents() {
    if (this.totalVoters <= 0) {
      return 0
    }

    let votesPercents = Math.round((this.votesAgainstNumber / this.totalVoters) * 100)
    if (isNaN(votesPercents)) votesPercents = 0
    return votesPercents
  }

  @action('Calculate time to start/finish')
  calcTimeTo = () => {
    const _now = moment()
    const start = moment.utc(this.startTime, USDateTimeFormat)
    const finish = moment.utc(this.endTime, USDateTimeFormat)
    let msStart = start.diff(_now)
    let msFinish = finish.diff(_now)

    if (msStart > 0) {
      this.timeToStart.val = msStart + 5000
      this.timeToStart.displayValue = this.formatMs(msStart, ':mm:ss')
      return (this.timeTo = this.timeToStart)
    }

    if (msFinish > 0) {
      this.timeToStart.val = 0
      this.timeToFinish.val = msFinish
      this.timeToFinish.displayValue = this.formatMs(msFinish, ':mm:ss')
      return (this.timeTo = this.timeToFinish)
    }

    this.timeToFinish.val = 0
    this.timeToFinish.displayValue = zeroTimeTo
    return (this.timeTo = this.timeToFinish)
  }

  formatMs(ms, format) {
    let dur = moment.duration(ms)
    let hours = Math.floor(dur.asHours())
    hours = hours < 10 ? '0' + hours : hours
    let formattedMs = hours + moment.utc(ms).format(':mm:ss')
    return formattedMs
  }

  @action('validator has already voted')
  getHasAlreadyVoted = async () => {
    const { contractsStore, id, votingType } = this.props
    let _hasAlreadyVoted = false
    try {
      _hasAlreadyVoted = await this.getContract(contractsStore, votingType).hasAlreadyVoted(
        id,
        contractsStore.votingKey
      )
    } catch (e) {
      console.log(e.message)
    }
    this.hasAlreadyVoted = _hasAlreadyVoted
  }

  isValidVote = async () => {
    const { contractsStore, id, votingType } = this.props
    let _isValidVote
    try {
      _isValidVote = await this.getContract(contractsStore, votingType).isValidVote(id, contractsStore.votingKey)
    } catch (e) {
      console.log(e.message)
    }
    return _isValidVote
  }

  isActive = async () => {
    const { contractsStore, id, votingType } = this.props
    let _isActive = await this.repeatGetProperty(contractsStore, votingType, id, 'isActive', 0)
    return _isActive
  }

  canBeFinalizedNow = async () => {
    const { contractsStore, id, votingType } = this.props
    let _canBeFinalizedNow = await this.repeatGetProperty(contractsStore, votingType, id, 'canBeFinalizedNow', 0)
    this.canBeFinalized = _canBeFinalizedNow
  }

  vote = async ({ choice }) => {
    if (this.timeToStart.val > 0) {
      swal('Warning!', messages.ballotIsNotActiveMsg(this.timeTo.displayValue), 'warning')
      return
    }
    const { commonStore, contractsStore, id, votingType, ballotsStore, pos } = this.props
    const { push } = this.props.routing
    if (!contractsStore.isValidVotingKey) {
      swal('Warning!', messages.invalidVotingKeyMsg(contractsStore.votingKey), 'warning')
      return
    }
    commonStore.showLoading()
    let isValidVote = await this.isValidVote()
    if (!isValidVote) {
      commonStore.hideLoading()
      swal('Warning!', messages.INVALID_VOTE_MSG, 'warning')
      return
    }

    const contract = this.getContract(contractsStore, votingType)

    sendTransactionByVotingKey(
      this.props,
      contract.address,
      contract.vote(id, choice),
      async tx => {
        const ballotInfo = await contract.getBallotInfo(id, contractsStore.votingKey)

        this.totalVoters = Number(ballotInfo.totalVoters)
        this.progress = Number(ballotInfo.progress)
        this.isFinalized = Boolean(ballotInfo.isFinalized)
        if (ballotInfo.hasOwnProperty('canBeFinalizedNow')) {
          this.canBeFinalized = Boolean(ballotInfo.canBeFinalizedNow)
        } else {
          await this.canBeFinalizedNow()
        }
        this.hasAlreadyVoted = true

        ballotsStore.ballotCards[pos].props.votingState.totalVoters = this.totalVoters
        ballotsStore.ballotCards[pos].props.votingState.progress = this.progress
        ballotsStore.ballotCards[pos].props.votingState.isFinalized = this.isFinalized
        ballotsStore.ballotCards[pos].props.votingState.canBeFinalized = this.canBeFinalized
        ballotsStore.ballotCards[pos].props.votingState.hasAlreadyVoted = this.hasAlreadyVoted

        swal('Congratulations!', messages.VOTED_SUCCESS_MSG, 'success').then(result => {
          push(`${commonStore.rootPath}`)
        })
      },
      messages.VOTE_FAILED_TX
    )
  }

  finalize = async e => {
    if (this.isFinalized) {
      return
    }

    if (this.timeToStart.val > 0) {
      swal('Warning!', messages.ballotIsNotActiveMsg(this.timeTo.displayValue), 'warning')
      return
    }
    const { commonStore, contractsStore, id, votingType, ballotsStore, pos } = this.props
    const { push } = this.props.routing
    if (!contractsStore.isValidVotingKey) {
      swal('Warning!', messages.invalidVotingKeyMsg(contractsStore.votingKey), 'warning')
      return
    }
    if (this.isFinalized) {
      swal('Warning!', messages.ALREADY_FINALIZED_MSG, 'warning')
      return
    }
    commonStore.showLoading()
    await this.canBeFinalizedNow()
    let _canBeFinalized = this.canBeFinalized
    if (_canBeFinalized === null) {
      console.log('canBeFinalizedNow is not existed')
      _canBeFinalized = !(await this.isActive())
    }
    if (!_canBeFinalized) {
      commonStore.hideLoading()
      swal('Warning!', messages.INVALID_FINALIZE_MSG, 'warning')
      return
    }

    const contract = this.getContract(contractsStore, votingType)

    sendTransactionByVotingKey(
      this.props,
      contract.address,
      contract.finalize(id),
      async tx => {
        const events = await contract.instance.getPastEvents('BallotFinalized', {
          fromBlock: tx.blockNumber,
          toBlock: tx.blockNumber
        })
        if (events.length > 0) {
          this.isFinalized = true
          ballotsStore.ballotCards[pos].props.votingState.isFinalized = this.isFinalized
          if (this.canBeFinalized !== null) {
            this.canBeFinalized = false
            ballotsStore.ballotCards[pos].props.votingState.canBeFinalized = this.canBeFinalized
          }
          swal('Congratulations!', messages.FINALIZED_SUCCESS_MSG, 'success').then(result => {
            push(`${commonStore.rootPath}`)
          })
        } else {
          swal('Warning!', messages.INVALID_FINALIZE_MSG, 'warning')
        }
      },
      messages.FINALIZE_FAILED_TX
    )
  }

  repeatGetProperty = async (contractsStore, contractType, id, methodID, tryID) => {
    try {
      let val = await this.getContract(contractsStore, contractType)[methodID](id)
      if (tryID > 0) {
        console.log(`success from Try ${tryID + 1}`)
      }
      return val
    } catch (e) {
      if (tryID < 10) {
        console.log(`trying to repeat get value again... Try ${tryID + 1}`)
        tryID++
        await setTimeout(async () => {
          this.repeatGetProperty(contractsStore, contractType, id, methodID, tryID)
        }, 1000)
      } else {
        return null
      }
    }
  }

  getContract(contractsStore, contractType) {
    switch (contractType) {
      case 'votingToChangeKeys':
        return contractsStore.votingToChangeKeys
      case 'votingToChangeMinThreshold':
        return contractsStore.votingToChangeMinThreshold
      case 'votingToChangeProxy':
        return contractsStore.votingToChangeProxy
      case 'validatorMetadata':
        return contractsStore.validatorMetadata
      default:
        return contractsStore.votingToChangeKeys
    }
  }

  getThreshold(contractsStore, votingType) {
    switch (votingType) {
      case 'votingToChangeKeys':
        return contractsStore.keysBallotThreshold
      case 'votingToChangeMinThreshold':
        return contractsStore.minThresholdBallotThreshold
      case 'votingToChangeProxy':
        return contractsStore.proxyBallotThreshold
      default:
        return contractsStore.keysBallotThreshold
    }
  }

  constructor(props) {
    super(props)
    const { votingState } = this.props
    // getTimes
    this.startTime = moment.utc(votingState.startTime * 1000).format(USDateTimeFormat)
    this.endTime = moment.utc(votingState.endTime * 1000).format(USDateTimeFormat)
    this.calcTimeTo()
    // getCreator
    this.creator = votingState.creator
    this.creatorMiningKey = votingState.creatorMiningKey
    // getTotalVoters
    this.totalVoters = Number(votingState.totalVoters)
    // getProgress
    this.progress = Number(votingState.progress)
    // getIsFinalized
    this.isFinalized = votingState.isFinalized
    // canBeFinalizedNow
    this.canBeFinalized = votingState.hasOwnProperty('canBeFinalizedNow') ? votingState.canBeFinalizedNow : null
    // getMemo
    this.memo = votingState.memo
    // hasAlreadyVoted
    if (votingState.hasOwnProperty('hasAlreadyVoted')) {
      this.hasAlreadyVoted = votingState.hasAlreadyVoted
    } else {
      this.getHasAlreadyVoted()
    }
    this.state = {
      detailsCollapsed: this.memo.length > maxDetailsLength
    }
  }

  toggleDetails = () => {
    this.setState(prevState => ({ detailsCollapsed: !prevState.detailsCollapsed }))
  }

  componentDidMount() {
    this.interval = setInterval(() => {
      this.calcTimeTo()
    }, 1000)
  }

  componentWillUnmount() {
    window.clearInterval(this.interval)
  }

  showCard = () => {
    let { commonStore } = this.props
    let checkToFinalizeFilter = commonStore.isToFinalizeFilter
      ? !this.isFinalized && (this.timeToFinish.val === 0 || this.canBeFinalized) && this.timeToStart.val === 0
      : true
    let show = commonStore.isActiveFilter ? !this.isFinalized : checkToFinalizeFilter
    return show
  }

  typeName(type) {
    switch (type) {
      case 'votingToChangeMinThreshold':
        return 'Consensus'
      case 'votingToChangeKeys':
        return 'Keys'
      case 'votingToChangeProxy':
        return 'Proxy'
      default:
        return ''
    }
  }

  render() {
    let { contractsStore, votingType, children } = this.props
    let ballotClass = this.showCard()
      ? this.isFinalized
        ? 'ballots-i'
        : 'ballots-i ballots-i-not-finalized'
      : 'ballots-i display-none'
    let voteScaleClass = 'vote-scale'
    let hasAlreadyVotedLabel = (
      <div className="ballots-i--vote ballots-i--vote-label ballots-i--vote-label-right ballots-i--vote_no">
        You already voted
      </div>
    )
    let showHasAlreadyVotedLabel = this.hasAlreadyVoted ? hasAlreadyVotedLabel : ''
    const threshold = this.getThreshold(contractsStore, votingType)
    let toggleShowMore =
      this.memo.length > maxDetailsLength ? (
        <span className="toggle-show more" onClick={this.toggleDetails}>
          {this.state.detailsCollapsed ? 'More...' : 'Less'}
        </span>
      ) : (
        ''
      )
    return (
      <div className={ballotClass}>
        <div className="ballots-about">
          <div className="ballots-about-i ballots-about-i_name">
            <div className="ballots-about-td ballots-about-td-title">
              <p className="ballots-about-i--title">Proposer</p>
            </div>
            <div className="ballots-about-td ballots-about-td-value">
              <p className="ballots-i--name">{this.creator}</p>
            </div>
          </div>
          {children}
          <div className="ballots-about-i ballots-about-i_time">
            <div className="ballots-about-td ballots-about-td-title">
              <p className="ballots-about-i--title">Ballot Time</p>
            </div>
            <div className="ballots-about-td ballots-about-td-value">
              <p className="ballots-i--created">{this.startTime}</p>
              <p className="ballots-i--time">
                {this.timeTo.displayValue}&nbsp;({this.timeTo.title})
              </p>
            </div>
          </div>
        </div>
        {/* TODO: Send / Burn / Freeze */}
        {/* <div className="ballots-i-scale">
          <div className="ballots-i-scale-column ballots-i-scale-column-3">
            <button
              className="btn btn-success ballots-i--vote_btn xl m-r-20"
              onClick={e => this.vote({ choice: ACCEPT })}
              type="button"
            >
              Send
            </button>
            <div className="vote-scale--container">
              <p className="vote-scale--votes">{this.votesForNumber} Votes</p>
              <p className="vote-scale--percentage">{this.votesForPercents}%</p>
              <div className={voteScaleClass}>
                <div
                  className="vote-scale--fill vote-scale--fill_send"
                  style={{ width: `${this.votesForPercents}%` }}
                />
              </div>
            </div>
          </div>
          <div className="ballots-i-scale-column ballots-i-scale-column-3">
            <button
              type="button"
              onClick={e => this.vote({ choice: REJECT })}
              className="btn btn-danger ballots-i--vote_btn xl m-r-20"
            >
              Burn
            </button>
            <div className="vote-scale--container">
              <p className="vote-scale--votes">{this.votesAgainstNumber} Votes</p>
              <p className="vote-scale--percentage">{this.votesAgainstPercents}%</p>
              <div className={voteScaleClass}>
                <div
                  className="vote-scale--fill vote-scale--fill_burn"
                  style={{ width: `${this.votesAgainstPercents}%` }}
                />
              </div>
            </div>
          </div>
          <div className="ballots-i-scale-column ballots-i-scale-column-3">
            <button
              type="button"
              onClick={e => this.vote({ choice: REJECT })}
              className="btn btn-freeze ballots-i--vote_btn xl m-r-20"
            >
              Freeze
            </button>
            <div className="vote-scale--container">
              <p className="vote-scale--votes">{this.votesAgainstNumber} Votes</p>
              <p className="vote-scale--percentage">{this.votesAgainstPercents}%</p>
              <div className={voteScaleClass}>
                <div
                  className="vote-scale--fill vote-scale--fill_freeze"
                  style={{ width: `${this.votesAgainstPercents}%` }}
                />
              </div>
            </div>
          </div>
        </div> */}
        {/* No / yes */}
        <div className="ballots-i-scale">
          <div className="ballots-i-scale-column">
            <button
              type="button"
              onClick={e => this.vote({ choice: REJECT })}
              className="btn btn-danger ballots-i--vote_btn m-r-20"
            >
              No
            </button>
            <div className="vote-scale--container">
              <p className="vote-scale--votes">{this.votesAgainstNumber} Votes</p>
              <p className="vote-scale--percentage">{this.votesAgainstPercents}%</p>
              <div className={voteScaleClass}>
                <div
                  className="vote-scale--fill vote-scale--fill_no"
                  style={{ width: `${this.votesAgainstPercents}%` }}
                />
              </div>
            </div>
          </div>
          <div className="ballots-i-scale-column reverse-responsive">
            <div className="vote-scale--container">
              <p className="vote-scale--votes">{this.votesForNumber} Votes</p>
              <p className="vote-scale--percentage">{this.votesForPercents}%</p>
              <div className={voteScaleClass}>
                <div className="vote-scale--fill vote-scale--fill_yes" style={{ width: `${this.votesForPercents}%` }} />
              </div>
            </div>
            <button
              className="btn btn-success ballots-i--vote_btn m-l-20"
              onClick={e => this.vote({ choice: ACCEPT })}
              type="button"
            >
              Yes
            </button>
          </div>
        </div>
        <div className="info-container">
          <div className="info info-minimum">
            Minimum {threshold} from {contractsStore.validatorsLength} validators are required to pass the proposal
          </div>
          <div className={`info info-details ${this.state.detailsCollapsed ? 'collapsed' : ''}`}>
            {this.state.detailsCollapsed
              ? this.memo.substr(0, this.memo.lastIndexOf(' ', maxDetailsLength))
              : this.memo}
            {toggleShowMore}
          </div>
        </div>
        <div className="ballots-footer">
          <div className="ballots-footer-left">
            <button type="button" onClick={e => this.finalize(e)} className={this.finalizeButtonClass}>
              {this.finalizeButtonDisplayName}
            </button>
            <p>{this.finalizeDescription}</p>
          </div>
          {showHasAlreadyVotedLabel}
          <div className="ballots-i--vote-label">
            {this.typeName(votingType)} Ballot ID: {this.props.id}
          </div>
        </div>
      </div>
    )
  }
}
